// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Non-custodial forecast records. Outcomes remain operator-reported, not trustless.
contract ForecastArena {
    address public immutable operator;
    address public pauser;
    address public roundCreator;
    bool public paused;
    uint256 public nextRoundId = 1;
    uint64 public constant MAX_COMMIT_WINDOW = 1 days;
    uint64 public constant MAX_REVEAL_WINDOW = 1 days;
    uint64 public constant MAX_OBSERVATION_WINDOW = 7 days;

    struct Round {
        bytes32 rulesHash;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 observationStart;
        uint64 observationEnd;
        bool settled;
        bool cancelled;
        uint256 outcome;
        bytes32 evidenceHash;
    }
    struct Prediction {
        address submitter;
        bytes32 commitment;
        uint256 value;
        bool revealed;
    }
    struct HumanPrediction {
        bytes32 commitment;
        uint256 value;
        bool revealed;
        bool missed;
    }
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(bytes32 => Prediction)) public predictions;
    mapping(uint256 => mapping(bytes32 => bool)) public missedPredictions;
    mapping(uint256 => mapping(address => HumanPrediction)) public humanPredictions;
    mapping(uint256 => address) public roundOrigin;

    event RoundCreated(uint256 indexed roundId, address indexed creator, bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd);
    event Committed(uint256 indexed roundId, bytes32 indexed agentId, address submitter, bytes32 commitment);
    event Revealed(uint256 indexed roundId, bytes32 indexed agentId, uint256 value);
    event MissedReveal(uint256 indexed roundId, bytes32 indexed agentId);
    event HumanCommitted(uint256 indexed roundId, address indexed submitter, bytes32 commitment);
    event HumanRevealed(uint256 indexed roundId, address indexed submitter, uint256 value);
    event HumanMissedReveal(uint256 indexed roundId, address indexed submitter);
    event Settled(uint256 indexed roundId, uint256 outcome, bytes32 evidenceHash);
    event Cancelled(uint256 indexed roundId);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event AccessControlsUpdated(address indexed pauser, address indexed roundCreator);

    constructor() {
        operator = msg.sender;
        pauser = msg.sender;
        roundCreator = msg.sender;
    }
    modifier onlyOperator() { require(msg.sender == operator, "Only operator"); _; }
    modifier onlyPauser() { require(msg.sender == pauser, "Only pauser"); _; }
    modifier onlyRoundCreator() { require(msg.sender == roundCreator, "Only round creator"); _; }
    modifier whenNotPaused() { require(!paused, "Paused"); _; }

    function setAccessControls(address newPauser, address newRoundCreator) external onlyOperator {
        require(newPauser != address(0) && newRoundCreator != address(0), "Invalid role");
        pauser = newPauser;
        roundCreator = newRoundCreator;
        emit AccessControlsUpdated(newPauser, newRoundCreator);
    }

    function pause() external onlyPauser {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyPauser {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function createRound(bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd) external onlyRoundCreator whenNotPaused returns (uint256 id) {
        return _createRound(rulesHash, commitDeadline, revealDeadline, observationStart, observationEnd);
    }

    function createUserRound(bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd) external whenNotPaused returns (uint256 id) {
        require(commitDeadline <= block.timestamp + MAX_COMMIT_WINDOW, "Commit window too long");
        require(revealDeadline <= commitDeadline + MAX_REVEAL_WINDOW, "Reveal window too long");
        require(observationEnd <= observationStart + MAX_OBSERVATION_WINDOW, "Observation window too long");
        return _createRound(rulesHash, commitDeadline, revealDeadline, observationStart, observationEnd);
    }

    function _createRound(bytes32 rulesHash, uint64 commitDeadline, uint64 revealDeadline, uint64 observationStart, uint64 observationEnd) internal returns (uint256 id) {
        require(rulesHash != bytes32(0), "Missing rules");
        require(block.timestamp < commitDeadline && commitDeadline < revealDeadline && revealDeadline <= observationStart && observationStart < observationEnd, "Invalid deadlines");
        id = nextRoundId++;
        rounds[id] = Round(rulesHash, commitDeadline, revealDeadline, observationStart, observationEnd, false, false, 0, bytes32(0));
        roundOrigin[id] = msg.sender;
        emit RoundCreated(id, msg.sender, rulesHash, commitDeadline, revealDeadline, observationStart, observationEnd);
    }

    function commitmentFor(uint256 id, bytes32 agentId, address submitter, uint256 value, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, agentId, submitter, value, salt));
    }

    function commit(uint256 id, bytes32 agentId, bytes32 commitment) external onlyOperator whenNotPaused {
        Round storage r = rounds[id];
        require(r.commitDeadline != 0 && !r.cancelled && block.timestamp < r.commitDeadline, "Commit closed");
        require(agentId != bytes32(0) && commitment != bytes32(0), "Empty commitment");
        require(predictions[id][agentId].submitter == address(0), "Already committed");
        predictions[id][agentId] = Prediction(msg.sender, commitment, 0, false);
        emit Committed(id, agentId, msg.sender, commitment);
    }

    function humanCommitmentFor(uint256 id, address submitter, uint256 value, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, submitter, value, salt));
    }

    function commitHuman(uint256 id, bytes32 commitment) external whenNotPaused {
        Round storage r = rounds[id];
        require(r.commitDeadline != 0 && !r.cancelled && block.timestamp < r.commitDeadline, "Commit closed");
        require(commitment != bytes32(0), "Empty commitment");
        require(humanPredictions[id][msg.sender].commitment == bytes32(0), "Already committed");
        humanPredictions[id][msg.sender] = HumanPrediction(commitment, 0, false, false);
        emit HumanCommitted(id, msg.sender, commitment);
    }

    function reveal(uint256 id, bytes32 agentId, uint256 value, bytes32 salt) external {
        Round storage r = rounds[id];
        require(!r.cancelled && block.timestamp >= r.commitDeadline && block.timestamp < r.revealDeadline, "Reveal closed");
        Prediction storage p = predictions[id][agentId];
        require(p.submitter == msg.sender && !p.revealed, "Not revealable");
        require(p.commitment == commitmentFor(id, agentId, msg.sender, value, salt), "Invalid reveal");
        p.value = value;
        p.revealed = true;
        emit Revealed(id, agentId, value);
    }

    function revealHuman(uint256 id, uint256 value, bytes32 salt) external {
        Round storage r = rounds[id];
        require(!r.cancelled && block.timestamp >= r.commitDeadline && block.timestamp < r.revealDeadline, "Reveal closed");
        HumanPrediction storage p = humanPredictions[id][msg.sender];
        require(p.commitment != bytes32(0) && !p.revealed && !p.missed, "Not revealable");
        require(p.commitment == humanCommitmentFor(id, msg.sender, value, salt), "Invalid reveal");
        p.value = value;
        p.revealed = true;
        emit HumanRevealed(id, msg.sender, value);
    }

    function markMissedReveal(uint256 id, bytes32 agentId) external {
        Round storage r = rounds[id];
        require(r.commitDeadline != 0 && !r.cancelled && block.timestamp >= r.revealDeadline, "Reveal active");
        Prediction storage p = predictions[id][agentId];
        require(p.submitter != address(0) && !p.revealed && !missedPredictions[id][agentId], "Not a missed reveal");
        missedPredictions[id][agentId] = true;
        emit MissedReveal(id, agentId);
    }

    function markHumanMissedReveal(uint256 id, address submitter) external {
        Round storage r = rounds[id];
        require(r.commitDeadline != 0 && !r.cancelled && block.timestamp >= r.revealDeadline, "Reveal active");
        HumanPrediction storage p = humanPredictions[id][submitter];
        require(p.commitment != bytes32(0) && !p.revealed && !p.missed, "Not a missed reveal");
        p.missed = true;
        emit HumanMissedReveal(id, submitter);
    }

    function settle(uint256 id, uint256 outcome, bytes32 evidenceHash) external onlyOperator {
        Round storage r = rounds[id];
        require(r.commitDeadline != 0 && !r.cancelled && block.timestamp >= r.observationEnd, "Not settleable");
        require(evidenceHash != bytes32(0), "Missing evidence");
        if (r.settled) {
            require(r.outcome == outcome && r.evidenceHash == evidenceHash, "Conflicting settlement");
            return;
        }
        r.outcome = outcome;
        r.evidenceHash = evidenceHash;
        r.settled = true;
        emit Settled(id, outcome, evidenceHash);
    }

    function cancel(uint256 id) external {
        require(msg.sender == operator || msg.sender == pauser, "Not authorized");
        Round storage r = rounds[id];
        require(r.commitDeadline != 0 && !r.settled && !r.cancelled, "Not cancellable");
        r.cancelled = true;
        emit Cancelled(id);
    }

}

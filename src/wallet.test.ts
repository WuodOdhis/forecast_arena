import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  parseAbi,
} from 'viem';
import { readHumanPrediction, submitHumanCommitment, submitHumanReveal } from './wallet.js';

const address = '0x1111111111111111111111111111111111111111' as const;
const contract = '0x2222222222222222222222222222222222222222' as const;
const abi = parseAbi([
  'function humanCommitmentFor(uint256 id, address submitter, uint256 value, bytes32 salt) view returns (bytes32)',
  'function humanPredictions(uint256, address) view returns (bytes32 commitment, uint256 value, bool revealed, bool missed)',
]);
const commitmentSelector = encodeFunctionData({
  abi,
  functionName: 'humanCommitmentFor',
  args: [1n, address, 12n, `0x${'0'.repeat(64)}`],
}).slice(0, 10);
const predictionSelector = encodeFunctionData({
  abi,
  functionName: 'humanPredictions',
  args: [1n, address],
}).slice(0, 10);
const storage = new Map<string, string>();

test('wallet human prediction commits then reveals using the saved local secret', async () => {
  const methods: string[] = [];
  let currentCommitment = `0x${'0'.repeat(64)}` as `0x${string}`;
  let revealed = false;
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      methods.push(method);
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_chainId') return '0x3c8';
      if (method === 'eth_call') {
        const transaction = (params?.[0] as { data: `0x${string}` }).data;
        if (transaction.startsWith(commitmentSelector)) {
          const salt = `0x${transaction.slice(-64)}` as `0x${string}`;
          currentCommitment = keccak256(
            encodeAbiParameters(
              [
                { type: 'uint256' },
                { type: 'address' },
                { type: 'uint256' },
                { type: 'address' },
                { type: 'uint256' },
                { type: 'bytes32' },
              ],
              [968n, contract, 1n, address, 12n, salt],
            ),
          );
          return encodeFunctionResult({
            abi,
            functionName: 'humanCommitmentFor',
            result: currentCommitment,
          });
        }
        assert.ok(transaction.startsWith(predictionSelector));
        return encodeFunctionResult({
          abi,
          functionName: 'humanPredictions',
          result: [currentCommitment, 12n, revealed, false],
        });
      }
      if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
      if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
      throw new Error(`Unexpected provider method ${method}`);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { ethereum: provider },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: globalThis.crypto,
  });

  const committed = await submitHumanCommitment('staging', 968, contract, '1', address, 12);
  assert.match(committed.txHash, /^0x[0-9a-f]{64}$/);
  assert.match(committed.commitment, /^0x[0-9a-f]{64}$/);
  const state = await readHumanPrediction('staging', 968, contract, '1', address);
  assert.equal(state.commitment, committed.commitment);
  assert.equal(state.revealed, false);

  const revealTx = await submitHumanReveal('staging', 968, contract, '1', address);
  assert.match(revealTx, /^0x[0-9a-f]{64}$/);
  revealed = true;
  assert.deepEqual(methods.filter((method) => method === 'eth_sendTransaction').length, 2);
  assert.ok([...storage.values()].some((value) => value.includes('"value":12')));
});

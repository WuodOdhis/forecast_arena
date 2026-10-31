import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { formatEther, type Abi, type Hex } from 'viem';
import { assertChain, profile, rpc, signer } from '../server/chain.js';

type DeploymentArtifact = { abi: Abi; bytecode: { object: Hex } };

function isDeploymentArtifact(value: unknown): value is DeploymentArtifact {
  if (!value || typeof value !== 'object') return false;
  const artifact = value as { abi?: unknown; bytecode?: { object?: unknown } };
  return (
    Array.isArray(artifact.abi) &&
    typeof artifact.bytecode?.object === 'string' &&
    /^0x[0-9a-fA-F]+$/.test(artifact.bytecode.object)
  );
}

const command = process.argv[2] ?? '--dry-run';
if (!['--dry-run', '--broadcast-testnet', '--broadcast-mainnet'].includes(command))
  throw new Error('Use --dry-run, --broadcast-testnet, or --broadcast-mainnet.');

const expectedProfile =
  command === '--broadcast-testnet'
    ? 'testnet'
    : command === '--broadcast-mainnet'
      ? 'mainnet'
      : profile.id;
if (profile.id !== expectedProfile)
  throw new Error(`Selected profile is ${profile.id}; deployment command requires ${expectedProfile}.`);
if (
  command === '--broadcast-mainnet' &&
  process.env.CONFIRM_MAINNET_DEPLOYMENT !== 'I understand this deploys ForecastArena on BOT Chain mainnet'
)
  throw new Error(
    'Set CONFIRM_MAINNET_DEPLOYMENT to the exact confirmation phrase before broadcasting.',
  );

await assertChain();
const wallet = signer();
const artifactPath = 'out/ForecastArena.sol/ForecastArena.json';
const artifactJson: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'));
if (!isDeploymentArtifact(artifactJson))
  throw new Error(`Invalid or empty deployment artifact at ${artifactPath}. Rebuild contracts first.`);

const [estimatedGas, gasPrice, balance] = await Promise.all([
  rpc.estimateGas({
    account: wallet.account.address,
    data: artifactJson.bytecode.object,
  }),
  rpc.getGasPrice(),
  rpc.getBalance({ address: wallet.account.address }),
]);
const maximumFee = estimatedGas * gasPrice;
console.log(`Profile: ${profile.name} (${profile.chainId})`);
console.log(`Deployer: ${wallet.account.address}`);
console.log(`Available balance: ${formatEther(balance)} ${profile.nativeCurrency.symbol}`);
console.log(`Estimated gas: ${estimatedGas}`);
console.log(`Current gas price: ${gasPrice} wei`);
console.log(`Estimated deployment fee: ${formatEther(maximumFee)} ${profile.nativeCurrency.symbol}`);

if (balance < maximumFee)
  throw new Error(
    `Insufficient balance for the estimated deployment fee; fund at least ${formatEther(maximumFee)} ${profile.nativeCurrency.symbol}.`,
  );

if (command === '--dry-run') {
  console.log('Dry run only. No transaction was signed or sent.');
  process.exit(0);
}

const hash = await wallet.deployContract({
  abi: artifactJson.abi,
  bytecode: artifactJson.bytecode.object,
  gas: estimatedGas,
  gasPrice,
});
console.log(`Deployment submitted: ${profile.explorerBaseUrl}/tx/${hash}`);
const receipt = await rpc.waitForTransactionReceipt({
  hash,
  confirmations: profile.confirmationsRequired,
});
if (receipt.status !== 'success' || !receipt.contractAddress)
  throw new Error('Deployment transaction did not succeed.');
const deployedCode = await rpc.getCode({ address: receipt.contractAddress });
if (!deployedCode || deployedCode === '0x')
  throw new Error('Deployment receipt has no contract code at its address.');

const addressEnvironment =
  profile.id === 'mainnet'
    ? 'MAINNET_ARENA_CONTRACT_ADDRESS'
    : profile.id === 'staging'
      ? 'STAGING_ARENA_CONTRACT_ADDRESS'
      : 'ARENA_CONTRACT_ADDRESS';
console.log(`${addressEnvironment}=${receipt.contractAddress}`);
console.log(`Contract: ${profile.explorerBaseUrl}/address/${receipt.contractAddress}`);

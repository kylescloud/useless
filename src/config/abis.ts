// ═══════════════════════════════════════════════════════════════════
//  MINIMAL ABIs FOR ALL CONTRACTS
//  Only includes functions actually used by the engine
// ═══════════════════════════════════════════════════════════════════

export const AAVE_POOL_ABI = [
    "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external",
    "function flashLoan(address receiverAddress, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata interestRateModes, address onBehalfOf, bytes calldata params, uint16 referralCode) external",
    "function getReserveData(address asset) external view returns (uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address, address, uint128, uint128, uint128)",
    "function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128)",
    "function getReservesList() external view returns (address[])",
] as const;

export const FLASH_ARB_ABI = [
    "function executeArbitrage(address asset, uint256 amount, bytes calldata params) external",
    "function executeMultiAssetArbitrage(address[] calldata assets, uint256[] calldata amounts, bytes calldata params) external",
    "function directSwap(uint8 dexId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, bytes calldata extraData) external returns (uint256)",
    "function directMultiSwap(tuple(uint8 dexId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, bytes extraData)[] calldata legs) external returns (uint256)",
    "function getFlashLoanPremium() external view returns (uint128)",
    "function getBalance(address token) external view returns (uint256)",
    "function getBalances(address[] calldata tokens) external view returns (uint256[])",
    "function owner() external view returns (address)",
    "function executor() external view returns (address)",
    "function paused() external view returns (bool)",
    "function minProfitBps() external view returns (uint256)",
    "function totalExecutions() external view returns (uint256)",
    "function setExecutor(address _executor) external",
    "function setMinProfitBps(uint256 _minProfitBps) external",
    "function setPaused(bool _paused) external",
    "function emergencyWithdraw(address token, uint256 amount) external",
    "function withdrawProfits(address token) external",
    "function batchWithdrawProfits(address[] calldata tokens) external",
    "event ArbitrageExecuted(address indexed asset, uint256 borrowAmount, uint256 profit, uint256 gasUsed, uint8 numLegs)",
] as const;

export const ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
] as const;

export const UNISWAP_V3_QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
] as const;

export const UNISWAP_V3_FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
] as const;

export const UNISWAP_V3_POOL_ABI = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() external view returns (uint128)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function fee() external view returns (uint24)",
    "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
] as const;

export const UNISWAP_V2_ROUTER_ABI = [
    "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
    "function factory() external view returns (address)",
] as const;

export const UNISWAP_V2_PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "event Sync(uint112 reserve0, uint112 reserve1)",
    "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
] as const;

export const UNISWAP_V2_FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
    "function allPairsLength() external view returns (uint256)",
] as const;

export const AERODROME_ROUTER_ABI = [
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[] amounts)",
    "function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)",
    "function defaultFactory() external view returns (address)",
] as const;

export const AERODROME_POOL_ABI = [
    "function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256)",
    "function stable() external view returns (bool)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function reserve0() external view returns (uint256)",
    "function reserve1() external view returns (uint256)",
] as const;

export const BALANCER_VAULT_ABI = [
    "function swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) external payable returns (uint256 amountCalculated)",
    "function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)",
] as const;

export const CURVE_POOL_ABI = [
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256)",
    "function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)",
    "function coins(uint256 index) external view returns (address)",
    "function balances(uint256 index) external view returns (uint256)",
] as const;

export const PANCAKE_V3_QUOTER_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
] as const;
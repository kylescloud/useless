// ═══════════════════════════════════════════════════════════════════
//  BASE CHAIN - ALL VERIFIED CONTRACT ADDRESSES
//  Chain ID: 8453
// ═══════════════════════════════════════════════════════════════════

export const BASE_CHAIN_ID = 8453;

// ═══════════════════════════════════════════════════════════════════
//                    AAVE V3 ON BASE
// ═══════════════════════════════════════════════════════════════════
export const AAVE = {
    POOL: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    POOL_ADDRESSES_PROVIDER: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    ORACLE: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    PROTOCOL_DATA_PROVIDER: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
    UI_POOL_DATA_PROVIDER: "0xb84A20e848baE3e13897934bB4e74E2225f4546B",
    WETH_GATEWAY: "0xa0d9C1E9E48Ca30c8d8C3B5D69FF5dc1f6DFfC24",
    L2_ENCODER: "0x39e97c588B2907Fb67F44fea256Ae3BA064207C5",
    FLASHLOAN_PREMIUM_BPS: 5, // 0.05%
} as const;

// ═══════════════════════════════════════════════════════════════════
//                BORROWABLE ASSETS ON AAVE V3 BASE
// ═══════════════════════════════════════════════════════════════════
export interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
    aToken: string;
    vToken: string;
    oracle: string;
}

export const TOKENS: Record<string, TokenInfo> = {
    WETH: {
        address: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        decimals: 18,
        aToken: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7",
        vToken: "0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E",
        oracle: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    },
    cbETH: {
        address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
        symbol: "cbETH",
        decimals: 18,
        aToken: "0xcf3D55c10DB69f28fD1A75Bd73f3D8A2d9c595ad",
        vToken: "0x1DabC36f19909425f654777249815c073E8Fd79F",
        oracle: "0x8e11Ad4531826ff47BD8157a2c705F5422Da6A61",
    },
    USDbC: {
        address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        symbol: "USDbC",
        decimals: 6,
        aToken: "0x0a1d576f3eFeF75b330424287a95A366e8281D54",
        vToken: "0x7376b2F323dC56fCd4C191B34163ac8a84702DAB",
        oracle: "0xfcF82bFa2485253263969167583Ea4de09e9993b",
    },
    wstETH: {
        address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
        symbol: "wstETH",
        decimals: 18,
        aToken: "0x99CBC45ea5bb7eF3a5BC08FB1B7E56bB2442Ef0D",
        vToken: "0x41A7C3f5904ad176dACbb1D99101F59ef0811DC1",
        oracle: "0x56038D3998C42db18ba3B821bD1EbaB9B678e657",
    },
    USDC: {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        decimals: 6,
        aToken: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
        vToken: "0x59dca05b6c26dbd64b5381374aAaC5CD05644C28",
        oracle: "0xfcF82bFa2485253263969167583Ea4de09e9993b",
    },
    weETH: {
        address: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A",
        symbol: "weETH",
        decimals: 18,
        aToken: "0x7C307e128efA31F540F2E2d976C995E0B65F51F6",
        vToken: "0x8D2e3F1f4b38AA9f1ceD22ac06019c7561B03901",
        oracle: "0xFc4d1d7a8FD1E6719e361e16044b460737F12C44",
    },
    cbBTC: {
        address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        symbol: "cbBTC",
        decimals: 8,
        aToken: "0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6",
        vToken: "0x05e08702028de6AaD395DC6478b554a56920b9AD",
        oracle: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
    },
    ezETH: {
        address: "0x2416092f143378750bb29b79eD961ab195CcEea5",
        symbol: "ezETH",
        decimals: 18,
        aToken: "0xDD5745756C2de109183c6B5bB886F9207bEF114D",
        vToken: "0xbc4f5631f2843488792e4F1660d0A51Ba489bdBd",
        oracle: "0x438e24f5FCDC1A66ecb25D19B5543e0Cb91A44D4",
    },
    GHO: {
        address: "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee",
        symbol: "GHO",
        decimals: 18,
        aToken: "0x067ae75628177FD257c2B1e500993e1a0baBcBd1",
        vToken: "0x38e59ADE183BbEb94583d44213c8f3297e9933e9",
        oracle: "0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73",
    },
    wrsETH: {
        address: "0xEDfa23602D0EC14714057867A78d01e94176BEA0",
        symbol: "wrsETH",
        decimals: 18,
        aToken: "0x80a94C36747CF51b2FbabDfF045f6D22c1930eD1",
        vToken: "0xe9541C77a111bCAa5dF56839bbC50894eba7aFcb",
        oracle: "0x567E7f3DB2CD4C81872F829C8ab6556616818580",
    },
    LBTC: {
        address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1",
        symbol: "LBTC",
        decimals: 8,
        aToken: "0x90072A4aA69B5Eb74984Ab823EFC5f91e90b3a72",
        vToken: "0xa2525b3f058846075506903d792d58C5a0D834c9",
        oracle: "0xA04669FE5cba4Bb21f265B562D23e562E45A1C67",
    },
    EURC: {
        address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
        symbol: "EURC",
        decimals: 6,
        aToken: "0x90DA57E0A6C0d166Bf15764E03b83745Dc90025B",
        vToken: "0x03D01595769333174036832e18fA2f17C74f8161",
        oracle: "0x215f25556f91b30AFCF0a12dA51C9d4374B22570",
    },
    AAVE: {
        address: "0x63706e401c06ac8513145b7687A14804d17f814b",
        symbol: "AAVE",
        decimals: 18,
        aToken: "0x67EAF2BeE4384a2f84Da9Eb8105C661C123736BA",
        vToken: "0xcEC1Ea95dDEF7CFC27D3D9615E05b035af460978",
        oracle: "0x3d6774EF702A10b20FCa8Ed40FC022f7E4938e07",
    },
    tBTC: {
        address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b",
        symbol: "tBTC",
        decimals: 18,
        aToken: "0xbcFFB4B3beADc989Bd1458740952aF6EC8fBE431",
        vToken: "0x182cDEEC1D52ccad869d621bA422F449FA5809f5",
        oracle: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
    },
    syrupUSDC: {
        address: "0x660975730059246A68521a3e2FBD4740173100f5",
        symbol: "syrupUSDC",
        decimals: 6,
        aToken: "0xD7424238CcbE7b7198Ab3cFE232e0271E22da7bd",
        vToken: "0x57B8C05ee2cD9d0143eBC21FBD9288C39B9F716c",
        oracle: "0xa61f10Bb2f05A94728734A8a95673ADbCA9B8397",
    },
} as const;

// ═══════════════════════════════════════════════════════════════════
//                  TOP 10 DEXs ON BASE CHAIN
// ═══════════════════════════════════════════════════════════════════
export enum DEXId {
    UNISWAP_V3 = 1,
    UNISWAP_V2 = 2,
    AERODROME_V2 = 3,
    AERODROME_CL = 4,
    PANCAKESWAP_V3 = 5,
    SUSHISWAP_V3 = 6,
    BALANCER_V2 = 7,
    CURVE = 8,
    BASESWAP_V3 = 9,
    MAVERICK_V2 = 10,
    ZEROX = 11,
}

export interface DEXConfig {
    id: DEXId;
    name: string;
    type: "v2" | "v3" | "cl" | "stable" | "balancer" | "aggregator";
    router: string;
    factory: string;
    quoter: string;
    fees: number[];       // Available fee tiers in bps (V3) or empty (V2)
    initCodeHash: string; // For off-chain pool address computation
}

export const DEXES: Record<string, DEXConfig> = {
    UNISWAP_V3: {
        id: DEXId.UNISWAP_V3,
        name: "Uniswap V3",
        type: "v3",
        router: "0x2626664c2603336E57B271c5C0b26F421741e481",
        factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        fees: [100, 500, 3000, 10000],
        initCodeHash: "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54",
    },
    UNISWAP_V2: {
        id: DEXId.UNISWAP_V2,
        name: "Uniswap V2",
        type: "v2",
        router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
        factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
        quoter: "",
        fees: [30], // 0.3%
        initCodeHash: "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f",
    },
    AERODROME_V2: {
        id: DEXId.AERODROME_V2,
        name: "Aerodrome V2",
        type: "v2",
        router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
        factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
        quoter: "",
        fees: [1, 5, 30], // volatile + stable
        initCodeHash: "",
    },
    AERODROME_CL: {
        id: DEXId.AERODROME_CL,
        name: "Aerodrome SlipStream",
        type: "cl",
        router: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5",
        factory: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
        quoter: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
        fees: [1, 2, 5, 10, 50, 100, 200],
        initCodeHash: "",
    },
    PANCAKESWAP_V3: {
        id: DEXId.PANCAKESWAP_V3,
        name: "PancakeSwap V3",
        type: "v3",
        router: "0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86",
        factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
        quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
        fees: [100, 500, 2500, 10000],
        initCodeHash: "0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2",
    },
    SUSHISWAP_V3: {
        id: DEXId.SUSHISWAP_V3,
        name: "SushiSwap V3",
        type: "v3",
        router: "0xFB7eF66a7e61224DD6FcD0D7d9C3Bb5C8b049b9f",
        factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
        quoter: "0xb1E835Dc2785b52265711e17fCCb0FD018226a6e",
        fees: [100, 500, 3000, 10000],
        initCodeHash: "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54",
    },
    BALANCER_V2: {
        id: DEXId.BALANCER_V2,
        name: "Balancer V2",
        type: "balancer",
        router: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
        factory: "0x4C32a8a8fDa6E24b492a6B20e5b5d2b1082c38c0",
        quoter: "",
        fees: [],
        initCodeHash: "",
    },
    CURVE: {
        id: DEXId.CURVE,
        name: "Curve",
        type: "stable",
        router: "0xd6681e74eEA20d196c209F178c55D440b36C4A43",
        factory: "0xd2002373543Ce3527023C75e7518C274A51ce712",
        quoter: "",
        fees: [1, 4], // 0.01% - 0.04%
        initCodeHash: "",
    },
    BASESWAP_V3: {
        id: DEXId.BASESWAP_V3,
        name: "BaseSwap V3",
        type: "v3",
        router: "0x1B8eea9315bE495187D873DA7773a874545D9D48",
        factory: "0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB",
        quoter: "0x4fDBD73aD4B1DDde594BF05497C15f76308eFfb9",
        fees: [500, 3000, 10000],
        initCodeHash: "",
    },
    MAVERICK_V2: {
        id: DEXId.MAVERICK_V2,
        name: "Maverick V2",
        type: "v3",
        router: "0x32AED3Bce901DA12ca8489788F3A99fCe1056e14",
        factory: "0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e",
        quoter: "",
        fees: [10, 30, 60, 100],
        initCodeHash: "",
    },
} as const;

// ═══════════════════════════════════════════════════════════════════
//                    0x AGGREGATOR CONFIG
// ═══════════════════════════════════════════════════════════════════
export const ZEROX = {
    API_URL: "https://api.0x.org",
    SWAP_ENDPOINT: "/swap/allowance-holder/quote",
    PRICE_ENDPOINT: "/swap/allowance-holder/price",
    CHAIN_ID: 8453,
    ALLOWANCE_HOLDER: "0x0000000000001fF3684f28c67538d4D072C22734",
    SETTLER: "0x00000000000004533Fe15556B1E086BB1A72cEae",
    PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

// ═══════════════════════════════════════════════════════════════════
//                    COMMON TOKEN PAIRS FOR ARB
// ═══════════════════════════════════════════════════════════════════
export const HIGH_LIQUIDITY_PAIRS = [
    { tokenA: "WETH", tokenB: "USDC" },
    { tokenA: "WETH", tokenB: "USDbC" },
    { tokenA: "WETH", tokenB: "cbETH" },
    { tokenA: "WETH", tokenB: "wstETH" },
    { tokenA: "WETH", tokenB: "weETH" },
    { tokenA: "WETH", tokenB: "ezETH" },
    { tokenA: "WETH", tokenB: "wrsETH" },
    { tokenA: "cbBTC", tokenB: "WETH" },
    { tokenA: "cbBTC", tokenB: "USDC" },
    { tokenA: "cbBTC", tokenB: "LBTC" },
    { tokenA: "cbBTC", tokenB: "tBTC" },
    { tokenA: "USDC", tokenB: "USDbC" },
    { tokenA: "USDC", tokenB: "EURC" },
    { tokenA: "USDC", tokenB: "GHO" },
    { tokenA: "cbETH", tokenB: "wstETH" },
    { tokenA: "weETH", tokenB: "wstETH" },
] as const;
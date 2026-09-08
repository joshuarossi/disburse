// Aave DAO address book and live contract reads, September 8, 2026.
// Base Sepolia uses Aave’s own test asset, distinct from Circle fee USDC.
export const AAVE_MARKETS = {
  "8453": {
    chainId: 8453,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    aToken: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
    pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    provider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    dataProvider: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
    oracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    priceSource: "0xf52D010c7d4ecBfda92c2509900593CE34535D86",
    assetLabel: "USDC",
    contracts: [
      {
        name: "pool",
        address: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        codeHash:
          "0xffcb26fbebbe09d9b0d8baef76a1fa218989be6c279b7acf9865d8fb6e0718ce",
        implementation: "0xa4abc5fcba6d0d7e3d144d6dbf6cb6128599dfdb",
        implementationCodeHash:
          "0x46a99baf41f90e39818ded14f4d45885fe6293496e72c1cea2014e814701a994",
      },
      {
        name: "provider",
        address: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
        codeHash:
          "0xefb34c67e8737046b820be55b2ee18d57d78eca48058175a3dde822d69b4fa69",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
      {
        name: "dataProvider",
        address: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
        codeHash:
          "0x7527531ca5dbfd9cbcedaad0f21686b45aefab17b6a1fa2f2198948b716bb631",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
      {
        name: "aToken",
        address: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
        codeHash:
          "0x59d2fd2a4bad76f979bc2c1da50504e072f4b3bb64f5429302a384ad9c0706f2",
        implementation: "0x273e4b97c3f5280aff4949aa19a27ff54968458d",
        implementationCodeHash:
          "0xb766d075565868563fa6712eed3c6c90afb71dc004230146eb77d8c6ed721145",
      },
      {
        name: "oracle",
        address: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
        codeHash:
          "0xabc7de2bbd6b21a5eead4ca887393fa1b311a46e89ed48d0ed4e3f12246b622b",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
    ],
  },
  "42161": {
    chainId: 42161,
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    aToken: "0x724dc807b04555b71ed48a6896b6F41593b8C637",
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    provider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    dataProvider: "0x243Aa95cAC2a25651eda86e80bEe66114413c43b",
    oracle: "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
    priceSource: "0xB0C9A7122aaB68F75CffD9851E867144DBFF113b",
    assetLabel: "USDC",
    contracts: [
      {
        name: "pool",
        address: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        codeHash:
          "0xf168c2e9e4d04292c7d5d526a9a917175a44369ab63a2f9997537acf0ffaaf2e",
        implementation: "0xf05fd3cc911b4c5e36e53c00354f645e22922c9a",
        implementationCodeHash:
          "0x9018e99643e0c9b7506f6c8233da851241f5bfddb06158e978fda41861fdea50",
      },
      {
        name: "provider",
        address: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
        codeHash:
          "0x1a95f317ee56e0b9aedc4f4b7abd9e546dc45c26d1d77e95bcf62b789d9a5486",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
      {
        name: "dataProvider",
        address: "0x243Aa95cAC2a25651eda86e80bEe66114413c43b",
        codeHash:
          "0x1274e68999f88a954cd6eb1ff95557e435f888c867d3db66d8e897caffc57cfe",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
      {
        name: "aToken",
        address: "0x724dc807b04555b71ed48a6896b6F41593b8C637",
        codeHash:
          "0xc3aa4c3619e0f36aac996ce2308856466850ac4ef7033e5fef29a8807d2ae6e8",
        implementation: "0xadcb7e98a462aa2375d03145083ee68a2148f077",
        implementationCodeHash:
          "0xc730301c56de6c1ab7feeecf24fd64795555b2e6c936e40e3f1882cac6e307a6",
      },
      {
        name: "oracle",
        address: "0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7",
        codeHash:
          "0xe9b8d7ac606312698d9b24a55f8d479d196482542f5553dc78887cfa305df8aa",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
    ],
  },
  "84532": {
    chainId: 84532,
    asset: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f",
    aToken: "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC",
    pool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
    provider: "0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00",
    dataProvider: "0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b",
    oracle: "0x943b0dE18d4abf4eF02A85912F8fc07684C141dF",
    priceSource: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
    assetLabel: "Aave test USDC",
    contracts: [
      {
        name: "pool",
        address: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
        codeHash:
          "0xc97b7e16966b0eafd8bc9eebf8937ee34f1bf0f3d3907d978dedc6148811b0f5",
        implementation: "0xe9fb54369e85b9714f9d86366d918c5c7c87783a",
        implementationCodeHash:
          "0xeb2f47a1422f8d12a135c1d1bd97eddb9980bfcc50e08206ae9b3a8c81c87db7",
      },
      {
        name: "provider",
        address: "0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00",
        codeHash:
          "0xdabec01ff02f2b5983c5095b31963c19e108624289f9614e0aaf33bbbcbbf0f6",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
      {
        name: "dataProvider",
        address: "0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b",
        codeHash:
          "0x3e0be195112ae2af98dc0044155884f86bd05526d957d166ee0e3aa6f7205f4a",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
      {
        name: "aToken",
        address: "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC",
        codeHash:
          "0x3b36b7f4d52e12a724fa5a94521b1810ad9cbcdcd5d00e98bfe93dbb5b7bfae8",
        implementation: "0xf83d6a049fe62b8a1270525e1516f93b61c7d113",
        implementationCodeHash:
          "0xdada526caf0a41d4d496294962fefc4720795a9ace2fce2c14d73b165d0632e9",
      },
      {
        name: "oracle",
        address: "0x943b0dE18d4abf4eF02A85912F8fc07684C141dF",
        codeHash:
          "0x6c318dd5f8cd219f1cb9c8d22f824f98da998fa3ea443e4758a8056abf315dc0",
        implementation: "0x0000000000000000000000000000000000000000",
        implementationCodeHash: null,
      },
    ],
  },
} as const;

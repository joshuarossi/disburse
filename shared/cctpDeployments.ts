// Official Circle addresses were checked against public RPC on September 8, 2026.
// Re-review provider upgrades before changing these implementation fingerprints.
export const CCTP_CONTRACT_PINS = {
  "8453": {
    messenger: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0x555e272506c06e7e559d57418563742afe363ec8",
      implementationCodeHash:
        "0x6c864e374854e06fd5d42b3e9de53ef9ad4d863b83a8c5dd1cf6e2a67fd2b535",
    },
    transmitter: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0x7db629f6acc20be49a0a7565c21cc178e9ac21e3",
      implementationCodeHash:
        "0x1c103738027742a17d3758356fc53deff294f9ac593189e104542e781c6f04a5",
    },
    minter: {
      codeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
      implementation: "0x0000000000000000000000000000000000000000",
      implementationCodeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
    },
  },
  "42161": {
    messenger: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0x555e272506c06e7e559d57418563742afe363ec8",
      implementationCodeHash:
        "0x6c864e374854e06fd5d42b3e9de53ef9ad4d863b83a8c5dd1cf6e2a67fd2b535",
    },
    transmitter: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0x7b93db2bc72faf642cec0adcac4f91718831a1f4",
      implementationCodeHash:
        "0xc627ecd30515b8b6ab2b4ee9bffb4a84277f836fa599a556a1f507dc05eea476",
    },
    minter: {
      codeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
      implementation: "0x0000000000000000000000000000000000000000",
      implementationCodeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
    },
  },
  "84532": {
    messenger: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0xf80e9e448f9d8cbfc42703419d78fe36fc350b76",
      implementationCodeHash:
        "0x8436939c0b47276d23461f67f34b90dde93a926f6dccd127c32316fe4893c131",
    },
    transmitter: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0xb1ab861ea37bc0eabe3ee993731cd8e4ef7bdf5f",
      implementationCodeHash:
        "0x1c103738027742a17d3758356fc53deff294f9ac593189e104542e781c6f04a5",
    },
    minter: {
      codeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
      implementation: "0x0000000000000000000000000000000000000000",
      implementationCodeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
    },
  },
  "11155111": {
    messenger: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0xf80e9e448f9d8cbfc42703419d78fe36fc350b76",
      implementationCodeHash:
        "0x8436939c0b47276d23461f67f34b90dde93a926f6dccd127c32316fe4893c131",
    },
    transmitter: {
      codeHash:
        "0xd2c8d48075d832fb7d07f6db5545a1bee37fdf886325c441a8dd1cef4c9dae99",
      implementation: "0x0bf2a7bc86e37684d45281e6a101dd639e918223",
      implementationCodeHash:
        "0x297080a27a2eac52d1be79af05bfa640a70b9dbc80f68fbb9e8db530e44924fd",
    },
    minter: {
      codeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
      implementation: "0x0000000000000000000000000000000000000000",
      implementationCodeHash:
        "0xfc330d52b7656b971ef47bbb8cd44877181fbc9ac0fe76cb4cb5bb364a992eff",
    },
  },
} as const;

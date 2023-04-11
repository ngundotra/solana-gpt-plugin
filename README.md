# Solana GPT Plugin
A ChatGPT plugin for Solana. Install as an unverified plugin with url `https://solana-gpt-plugin.onrender.com`.

<img width="650" alt="Screen Shot 2023-04-10 at 3 42 41 PM" src="https://user-images.githubusercontent.com/7481857/231182274-40b42f0e-5e5d-4050-9e31-2f75375481c1.png">

## Endpoints

ChatGPT can POST to the following resources with the same request payload, e.g.
```json
{
  "address": "8fbqVvpK3Dj7fdP2c8JJhtD7Zy3n9qtwAeGfbkgPu625"
}
```

### /getAccountInfo

Returns the output of `getAccountInfo` method from the RPC with buffer data, and if it can be deserialized by its program IDL, then the response payload has additional field called `extended` that has a JSON serialized string of the anchor data. Chat GPT's plugin model seems to be able to read this pretty well.
```json
{
  ...,
  "extended": "{\"authority\":\"8fbqVvpK3Dj7fdP2c8JJhtD7Zy3n9qtwAeGfbkgPu625\",\"numMinted\":50}"
}
```

### /getBalance

Returns
```json
{
  "lamports": 42690
}
```

### /getAssetsByOwner

Returns the assets returned by the [Metaplex Read API spec](https://github.com/metaplex-foundation/api-specifications/blob/main/specifications/read_api/openrpc_spec.json)

### /getTransaction

Accepts
```json
{
  "signature": "h51pjmFcn8LkxejofUQoDYkyubUKaB7bNtyMMSCCamSEYRutS2G2vm2w1ERShko8boRqdaaTAs4MR6sGYkTByNF"
}
```

Returns the transaction status metadata for the `getTransaction` method from the Solana RPC.


## Development

To install dependencies, just execute `yarn`. This project uses `node` with version `>=16.17.0`.

To start a development server, execute `yarn dev`. This will start the plugin available from `localhost:3333` with its own configuration settings in `.well-known-dev/`.

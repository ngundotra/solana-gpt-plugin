# Solana GPT Plugin
A ChatGPT plugin for Solana

<img width="794" alt="Screen Shot 2023-04-10 at 3 42 41 PM" src="https://user-images.githubusercontent.com/7481857/230983727-a2862030-258a-4dcf-949d-99efa47903f5.png">

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

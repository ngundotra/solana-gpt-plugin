import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  Program,
} from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

const app = express();
const port = process.env.PORT || 3333;

const HELIUS_URL = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}}`;
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_URL);

app.use(bodyParser.json());
app.use(
  cors({
    origin: "*",
  })
);
app.use("/.well-known", express.static("./.well-known"));

function replaceBNWithToString(obj: any): any {
  if (obj instanceof BN) {
    return obj.toString();
  } else if (obj instanceof PublicKey) {
    return obj.toString();
  }

  if (typeof obj === "object" && obj !== null) {
    return Object.keys(obj).reduce((acc: Record<string, any>, key: string) => {
      acc[key] = replaceBNWithToString(obj[key]);
      return acc;
    }, {});
  }

  return obj;
}

/**
 * Returns the data from the Metaplex Read API
 * @param address
 * @param page (optional) page number
 * @param limit (optional) set to 5 to prevent overflowing GPT context window
 * @returns
 */
const getAssetsByOwner = async (
  address: string,
  page: number = 1,
  limit: number = 5
) => {
  const sortBy = {
    sortBy: "created",
    sortDirection: "asc",
  };
  const before = "";
  const after = "";
  const { data } = await axios.post(HELIUS_URL, {
    jsonrpc: "2.0",
    id: "my-id",
    method: "getAssetsByOwner",
    params: [address, sortBy, limit, page, before, after],
  });
  return data.result;
};

/**
 * Returns accountInfo or extends it with deserialized account data if the account is a program account of an Anchor program
 * @param accountAddress
 * @returns
 */
async function getAccountInfo(accountAddress: PublicKey): Promise<Object> {
  const accountInfo = await connection.getAccountInfo(accountAddress);
  if (accountInfo?.owner && !accountInfo.executable) {
    try {
      const program = await Program.at(
        accountInfo.owner,
        new AnchorProvider(connection, new NodeWallet(Keypair.generate()), {
          commitment: "confirmed",
        })
      );

      const rawData = accountInfo.data;
      const coder = new BorshAccountsCoder(program.idl);
      const accountDefTmp = program.idl.accounts?.find((accountType: any) =>
        (rawData as Buffer)
          .slice(0, 8)
          .equals(BorshAccountsCoder.accountDiscriminator(accountType.name))
      );

      if (accountDefTmp) {
        const accountDef = accountDefTmp;
        const decodedAccountData = replaceBNWithToString(
          coder.decode(accountDef.name, rawData)
        );
        console.log(decodedAccountData);

        let payload = {
          ...accountInfo,
          extended: JSON.stringify(decodedAccountData),
        };
        return payload;
      }
    } catch (err) {
      console.log(err);
    }
  }
  return accountInfo || {};
}

app.post("/:methodName", async (req, res) => {
  // Inspect what ChatGPT is sending
  console.log(req.params.methodName, req.body);

  // Dispatch the request
  try {
    if (req.params.methodName === "getAssetsByOwner") {
      const accountAddress = new PublicKey(req.body.address);
      const assets = await getAssetsByOwner(accountAddress.toString());
      res.status(200).send({ message: JSON.stringify(assets) });
    } else if (req.params.methodName === "getAccountInfo") {
      const accountAddress = new PublicKey(req.body.address);
      const accountInfo = await getAccountInfo(accountAddress);
      res.status(200).send({ message: JSON.stringify(accountInfo) });
    } else if (req.params.methodName === "getBalance") {
      const { address } = req.body;
      const balance = await connection.getBalance(new PublicKey(address));
      return res.status(200).send({ lamports: JSON.stringify(balance) });
    }
  } catch (error) {
    console.error(error);

    // Prevent ChatGPT from getting access to error messages until we have a better error handling
    res.status(500).send({ message: "An error occurred" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

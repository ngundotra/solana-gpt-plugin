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

import { HyperspaceClient, TimeGranularityEnum } from "hyperspace-client-js";

import * as dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 3333;

const HELIUS_URL = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_URL);

app.use(bodyParser.json());
app.use(
  cors({
    origin: "*",
  })
);

if (process.env.DEV === "true") {
  app.use("/.well-known", express.static("./.well-known-dev"));
} else {
  app.use("/.well-known", express.static("./.well-known"));
}

/**
 * Replace Anchor data (BNs, PublicKeys) with stringified data
 * @param obj
 * @returns
 */
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
  // TODO: copy the explorer code here that manually deserializes a bunch of stuff, like Mango & Pyth

  const accountInfo = await connection.getAccountInfo(accountAddress);
  // If acccount is not a program, check for Anchor IDL
  if (accountInfo?.owner && !accountInfo.executable) {
    try {
      const program = await Program.at(
        accountInfo.owner,
        new AnchorProvider(connection, new NodeWallet(Keypair.generate()), {
          commitment: "confirmed",
        })
      );

      // Search through Anchor IDL for the account type
      const rawData = accountInfo.data;
      const coder = new BorshAccountsCoder(program.idl);
      const accountDefTmp = program.idl.accounts?.find((accountType: any) =>
        (rawData as Buffer)
          .slice(0, 8)
          .equals(BorshAccountsCoder.accountDiscriminator(accountType.name))
      );

      // If we found the Anchor IDL type, decode the account state
      if (accountDefTmp) {
        const accountDef = accountDefTmp;

        // Decode the anchor data & stringify the data
        const decodedAccountData = replaceBNWithToString(
          coder.decode(accountDef.name, rawData)
        );

        // Inspect the anchor data for fun 🤪
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

const HYPERSPACE_URL = "https://beta.api.solanalysis.com/rest";

async function hyperspaceGetCollectionStats(
  collection: string,
  page: number = 1,
  pageSize: number = 5
): Promise<Object> {
  const client = new HyperspaceClient(process.env.HYPERSPACE_API_KEY as string);
  let result = await client.getProjects({
    paginationInfo: {
      page_number: 1,
    },
  });
  console.log(result.getProjectStats.project_stats![0]);
  return result.getProjectStats;
  //   const url = HYPERSPACE_URL + "/get-project-stat-hist";
  //   console.log(url, process.env.HYPERSPACE_API_KEY);
  //   const start = new Date();
  //   start.setDate(start.getDate() - 3);
  //   const end = new Date();
  //   start.setDate(start.getDate() - 1);
  //   console.log(start.valueOf(), end.valueOf());

  //   const result = await axios.post(
  //     url,
  //     {
  //       conditions: {
  //         project_ids: [collection],
  //         start_timestamp: start.valueOf(), // 1641128400, // Date.now().valueOf() - 10000000,
  //         end_timestamp: end.valueOf(), //Date.now().valueOf(),
  //         time_granularity: "PER_HOUR",
  //       },
  //       pagination_info: {
  //         page_number: page,
  //         page_size: pageSize,
  //       },
  //     },
  //     {
  //       headers: {
  //         "Content-Type": "application/json",
  //         Authorization: process.env.HYPERSPACE_API_KEY,
  //       },
  //     }
  //   );
  //   console.log(result.data);
  //   return result.data;
}

// app.post("/:methodName", async (req, res) => {
//   // Inspect what ChatGPT is sending
//   console.log(req.params.methodName, req.body);
//   // Dispatch the request
//   try {
//     if (req.params.methodName === "getAssetsByOwner") {
//       const accountAddress = new PublicKey(req.body.address);
//       const assets = await getAssetsByOwner(accountAddress.toString());
//       res.status(200).send({ message: JSON.stringify(assets) });
//     } else if (req.params.methodName === "getAccountInfo") {
//       const accountAddress = new PublicKey(req.body.address);
//       const accountInfo = await getAccountInfo(accountAddress);
//       res.status(200).send({ message: JSON.stringify(accountInfo) });
//     } else if (req.params.methodName === "getBalance") {
//       const { address } = req.body;
//       const balance = await connection.getBalance(new PublicKey(address));
//       return res.status(200).send({ lamports: JSON.stringify(balance) });
//     }
//     else if (req.params.methodName === "getSignaturesForAddress") {
//       const accountAddress = new PublicKey(req.body.address);
//       const signatures = await connection.getSignaturesForAddress(
//         accountAddress,
//         {
//           limit: 11,
//           before: req.body.beforeSignature ?? null,
//           until: req.body.untilSignature ?? null,
//         }
//       );
//       return res.status(200).send({
//         hasMore: signatures.length === 11,
//         nextPage:
//           signatures.length === 11
//             ? { beforeSignature: signatures[10].signature }
//             : null,
//         signatures: JSON.stringify(signatures),
//       });
//     } else if (req.params.methodName === "getTransaction") {
//       const signature = req.body.signature;
//       const transaction = await connection.getTransaction(signature, {
//         maxSupportedTransactionVersion: 2,
//       });
//       res.status(200).send(JSON.stringify(transaction));
//     }
//   } catch (error) {
//     console.error(error);

//     // Prevent ChatGPT from getting access to error messages until we have a better error handling
//     res.status(500).send({ message: "An error occurred" });
//   }
// });

// app.listen(port, () => {
//   console.log(`Server running at http://localhost:${port}`);
// });

(async () => {
  console.log(Date.now());
  hyperspaceGetCollectionStats("degods");
})();

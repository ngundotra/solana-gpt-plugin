import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cors from "cors";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  Program,
} from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { HyperspaceClient } from "hyperspace-client-js";
import { encodeURL } from "@solana/pay";
import * as qrcode from "qrcode";
import sharp from "sharp";

import { base64, bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { encode } from "querystring";
import * as dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3333;

let SELF_URL: string;
if (process.env.DEV === "true") {
  SELF_URL = `http://localhost:${port}`;
} else {
  SELF_URL = "https://solana-gpt-plugin.onrender.com";
}

const HELIUS_URL = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_URL);

const hyperSpaceClient = new HyperspaceClient(
  process.env.HYPERSPACE_API_KEY as string
);

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

type ListedNFTResponse = {
  listings: {
    price: number;
    token: string;
  }[];
  currentPage: number;
  hasMore: boolean;
};

async function hyperspaceGetListedCollectionNFTs(
  projectId: string,
  pageNumber: number = 1,
  priceOrder: string = "DESC"
): Promise<ListedNFTResponse> {
  let results = await hyperSpaceClient.getMarketplaceSnapshot({
    condition: {
      projects: [{ project_id: projectId }],
      onlyListings: true,
    },
    orderBy: {
      field_name: "lowest_listing_price",
      sort_order: priceOrder as any,
    },
    paginationInfo: {
      page_number: pageNumber,
    },
  });

  let snaps = results.getMarketPlaceSnapshots.market_place_snapshots!;
  let orderedListings = snaps.sort(
    (a, b) => a.lowest_listing_mpa!.price! - b.lowest_listing_mpa!.price!
  );

  let crucialInfo = orderedListings
    .filter(
      (arr) =>
        // We filter out Magic Eden's marketplace because they
        // require an API key to make purchases programmatically
        arr.lowest_listing_mpa?.marketplace_program_id !==
        "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"
    )
    .map((arr) => {
      return {
        price: arr.lowest_listing_mpa!.price!,
        token: arr.token_address,
        marketplace: arr.lowest_listing_mpa!.marketplace_program_id!,
      };
    });

  return {
    listings: crucialInfo,
    currentPage: pageNumber,
    hasMore: results.getMarketPlaceSnapshots.pagination_info.has_next_page,
  };
}

async function hyperspaceGetCollectionsByFloorPrice(
  maxFloorPrice: number | undefined,
  minFloorPrice: number | undefined,
  pageNumber: number = 1,
  pageSize: number = 10,
  orderBy: string = "DESC",
  humanReadableSlugs: boolean = false
) {
  let projects = await hyperSpaceClient.getProjects({
    condition: {
      floorPriceFilter: {
        min: minFloorPrice ?? null,
        max: maxFloorPrice ?? null,
      },
    },
    orderBy: {
      field_name: "floor_price",
      sort_order: orderBy as any,
    },
    paginationInfo: {
      page_size: pageSize,
      page_number: pageNumber,
    },
  });

  let stats = projects.getProjectStats.project_stats?.map((project) => {
    return {
      id: project.project_id,
      desc: project.project?.display_name,
      img: project.project?.img_url ?? "",
      website: project.project?.website ?? "",
      floor_price: project.floor_price,
    };
  });
  console.log("Stats", stats!.length);
  if (humanReadableSlugs) {
    stats = stats?.filter((stat) => {
      try {
        bs58.decode(stat.id!);
        return false;
      } catch (err) {
        return true;
      }
    });
  }
  return {
    projects: stats,
    hasMore: projects.getProjectStats.pagination_info.has_next_page,
    currentPage: pageNumber,
  };
}

type CreateBuyTxResponse = {
  transaction: string;
};

async function hyperspaceCreateBuyTx(
  buyer: string,
  token: string,
  price: number
): Promise<CreateBuyTxResponse> {
  let transactionData = await hyperSpaceClient.createBuyTx({
    buyerAddress: buyer,
    tokenAddress: token,
    price: price,
    // Take no fee on making tx for ChatGPT users
    buyerBroker: "",
    buyerBrokerBasisPoints: 0,
  });
  console.log("Transaction Data", transactionData);
  const txBytes = base64.encode(
    Buffer.from(transactionData.createBuyTx.stdBuffer!)
  );
  console.log("Transaction bytes:", txBytes);

  return {
    transaction: txBytes,
  };
}

async function createQRCodePng(
  methodName: string,
  encoded: string
): Promise<Buffer> {
  let uri = new URL(`${SELF_URL}/sign/${methodName}?${encoded}`);
  let solanaPayUrl = encodeURL({
    link: uri,
  });
  console.log("Solana pay url", solanaPayUrl.toString());

  let dataUrl = await qrcode.toDataURL(solanaPayUrl.toString());
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");
  return await sharp(imageBuffer)
    .extend({
      extendWith: "background",
      background: "#ffffff",
      left: 110,
      right: 110,
    })
    .toBuffer();
}

function createOpenGraphMetaPage(
  methodName: string,
  encoded: string,
  description: string
): string {
  let qrCodeUri = new URL(`${SELF_URL}/qr/${methodName}?${encoded}`);
  return `<html>
    <meta property="og:title" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${SELF_URL}/page/${methodName}?${encoded}" />
    <meta property="og:image" content="${qrCodeUri}" />
    </html>`;
}

/**
 * Create QR code image
 */
app.get("/qr/:methodName", async (req, res) => {
  console.log("QR code requested:", req.params.methodName, req.query);

  if (req.params.methodName === "createBuyNFT") {
    const { buyer, token, price } = req.query;
    const encoded = encode({
      buyer: buyer as string,
      token: token as string,
      price: price as string,
    });
    let buffer = await createQRCodePng("createBuyNFT", encoded);
    res.status(200).send(buffer);
  } else {
    res
      .status(404)
      .send({ error: `Invalid method name ${req.params.methodName}` });
  }
});

/**
 * Create QR code image preview, by using the OpenGraph meta tags
 */
app.get("/page/:methodName", async (req, res) => {
  console.log(
    "OpenGraph metapage requested:",
    req.params.methodName,
    req.query
  );

  if (req.params.methodName === "createBuyNFT") {
    const { buyer, token, price } = req.query;
    const encoded = encode({
      buyer: buyer as string,
      token: token as string,
      price: price as string,
    });
    res
      .status(200)
      .send(
        createOpenGraphMetaPage("createBuyNFT", encoded, "Sign to Buy NFT")
      );
  } else {
    res
      .status(404)
      .send({ error: `Invalid method name ${req.params.methodName}` });
  }
});

/**
 * Solana pay compliant request
 */
app.get("/sign/:methodName", async (req, res) => {
  console.log("Tx requested: ", req.params.methodName, req.body);

  if (req.params.methodName === "createBuyNFT") {
    const { buyer, token, price } = req.query;
    const result = await hyperspaceCreateBuyTx(
      buyer as string,
      token as string,
      Number.parseFloat(price as string)
    );
    return res.status(200).send(JSON.stringify(result));
  } else {
    res
      .status(404)
      .send({ error: `Invalid method name ${req.params.methodName}` });
  }
});

app.post("/:methodName", async (req, res) => {
  // Inspect what ChatGPT is sending
  console.log(req.params.methodName, req.body);

  // Dispatch the request
  try {
    // RPC methods
    if (req.params.methodName === "getAccountInfo") {
      const accountAddress = new PublicKey(req.body.address);
      const accountInfo = await getAccountInfo(accountAddress);
      res.status(200).send({ message: JSON.stringify(accountInfo) });
    } else if (req.params.methodName === "getBalance") {
      const { address } = req.body;
      const balance = await connection.getBalance(new PublicKey(address));
      return res.status(200).send({ sol: balance / LAMPORTS_PER_SOL });
    } else if (req.params.methodName === "getSignaturesForAddress") {
      const accountAddress = new PublicKey(req.body.address);
      const signatures = await connection.getSignaturesForAddress(
        accountAddress,
        {
          limit: 11,
          before: req.body.beforeSignature ?? null,
          until: req.body.untilSignature ?? null,
        }
      );
      return res.status(200).send({
        hasMore: signatures.length === 11,
        nextPage:
          signatures.length === 11
            ? { beforeSignature: signatures[10].signature }
            : null,
        signatures: JSON.stringify(signatures),
      });
    } else if (req.params.methodName === "getTransaction") {
      const signature = req.body.signature;
      const transaction = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 2,
      });
      res.status(200).send(JSON.stringify(transaction));
    }

    // Metaplex ReadAPI methods
    if (req.params.methodName === "getAssetsByOwner") {
      const accountAddress = new PublicKey(req.body.address);
      const assets = await getAssetsByOwner(accountAddress.toString());
      res.status(200).send({ message: JSON.stringify(assets) });
    }

    // NFT specific methods - using Hyperspace
    if (req.params.methodName === "createBuyTransaction") {
      let { buyer, token, price } = req.body;
      const encoded = encode({
        buyer: buyer as string,
        token: token as string,
        price: price as number,
      });

      // Create an OpenGraph (https://ogp.me/) rich link preview
      // so that SolanaPay QR Code shows up to buy transaction
      res.status(200).send({
        linkToSign: `${SELF_URL}/page/createBuyNFT?${encoded}`,
      });
    } else if (req.params.methodName === "createTransferTransaction") {
      let { sender, mintOrProgram, recipient, amount } = req.body;
      const encoded = encode({
        sender: sender as string,
        mintOrProgram: mintOrProgram as string,
        recipient: recipient as string,
        amount: amount as string,
      });

      // Create an OpenGraph (https://ogp.me/) rich link preview
      // so that SolanaPay QR Code shows up to buy transaction
      res.status(200).send({
        linkToSign: `${SELF_URL}/page/createTransferNFT?${encoded}`,
      });
    } else if (req.params.methodName === "getListedCollectionNFTs") {
      const { projectId, pageNumber, priceOrder } = req.body;
      const result = await hyperspaceGetListedCollectionNFTs(
        projectId,
        pageNumber,
        priceOrder
      );
      return res.status(200).send(JSON.stringify(result));
    } else if (req.params.methodName === "getCollectionsByFloorPrice") {
      const {
        maxFloorPrice,
        minFloorPrice,
        orderBy,
        pageNumber,
        pageSize,
        humanReadable,
      } = req.body;
      const result = await hyperspaceGetCollectionsByFloorPrice(
        maxFloorPrice,
        minFloorPrice,
        pageNumber,
        pageSize,
        orderBy,
        humanReadable
      );
      return res.status(200).send(JSON.stringify(result));
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

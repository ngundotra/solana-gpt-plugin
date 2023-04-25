import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { HyperspaceClient } from "hyperspace-client-js";
import { encodeURL } from "@solana/pay";
import * as qrcode from "qrcode";
import sharp from "sharp";

import { base64, bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { encode } from "querystring";

import * as dotenv from "dotenv";
dotenv.config();

import {
  createWriteNFTMetadataTx,
  createCloseNFTMetadataTx,
} from "./on-chain-metadata/index";
import { getTransaction } from "./handlers/getTransaction";

import configConstants, { APP, PORT, CONNECTION, SELF_URL } from "./constants";
configConstants();

import { getSignaturesForAddress } from "./handlers/getSignaturesForAddress";
import { getAccountInfo } from "./handlers/getAccountInfo";
import { getBalance } from "./handlers/getBalance";
import { getAssetsByOwner } from "./handlers/getAssetsByOwner";

const hyperSpaceClient = new HyperspaceClient(
  process.env.HYPERSPACE_API_KEY as string
);

APP.use(bodyParser.json());
APP.use(
  cors({
    origin: "*",
  })
);

if (process.env.DEV === "true") {
  APP.use("/.well-known", express.static("./.well-known-dev"));
} else {
  APP.use("/.well-known", express.static("./.well-known"));
}

type NFTListing = {
  price: number;
  image: string;
  token: string;
};

type ListedNFTResponse = {
  listings: NFTListing[];
  hasMore: boolean;
};

async function hyperspaceGetListedCollectionNFTs(
  projectId: string,
  pageSize: number = 5,
  priceOrder: string = "DESC"
): Promise<ListedNFTResponse> {
  let listedNFTs: NFTListing[] = [];
  let hasMore = true;
  let pageNumber = 1;
  while (listedNFTs.length < pageSize && hasMore) {
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

    pageNumber += 1;
    let crucialInfo: NFTListing[] = orderedListings
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
          image: arr.meta_data_img ?? "",
          marketplace: arr.lowest_listing_mpa!.marketplace_program_id!,
        };
      });
    listedNFTs = listedNFTs.concat(crucialInfo);
    hasMore = results.getMarketPlaceSnapshots.pagination_info.has_next_page;
  }

  return {
    listings: listedNFTs.slice(0, pageSize),
    hasMore,
  };
}

type CollectionStats = {
  id: string;
  desc: string;
  img: string;
  website: string;
  floor_price: number;
};

/**
 * Provides a feed of NFT collections that the user can afford.
 */
async function hyperspaceGetCollectionsByFloorPrice(
  maxFloorPrice: number | undefined,
  minFloorPrice: number | undefined,
  pageSize: number = 5,
  orderBy: string = "DESC",
  humanReadableSlugs: boolean = false
) {
  let pageNumber = 1;
  let results: CollectionStats[] = [];
  let hasMore = true;
  while (results.length < pageSize && hasMore) {
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
        page_size: 512,
        page_number: pageNumber,
      },
    });

    let stats: CollectionStats[] =
      projects.getProjectStats.project_stats
        ?.filter((project) => {
          return (
            (project.volume_7day ?? 0 > 0) && (project.floor_price ?? 0 > 0)
          );
        })
        .map((project) => {
          return {
            id: project.project_id,
            desc: project.project?.display_name ?? "",
            img: project.project?.img_url ?? "",
            website: project.project?.website ?? "",
            floor_price: project.floor_price ?? 0,
          };
        }) ?? [];

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
    pageNumber += 1;
    console.log("\tFetching collection info... ", stats.length, pageNumber);
    results = results.concat(stats!);
    hasMore = projects.getProjectStats.pagination_info.has_next_page;
  }

  return {
    projects: results.slice(0, pageSize),
    hasMore: hasMore,
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

const SOLANA_PAY_LABEL = "Solana GPT Plugin";
async function createQRCodePng(
  methodName: string,
  encoded: string
): Promise<Buffer> {
  let uri = new URL(`${SELF_URL}/sign/${methodName}?${encoded}`);
  let solanaPayUrl = encodeURL({
    link: uri,
    label: SOLANA_PAY_LABEL,
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

let TX_DESCRIPTIONS: Record<string, string> = {
  createBuyNFT: "Sign to Buy NFT",
  createWriteNFTMetadata: "Sign to Write NFT Metadata",
  createCloseNFTMetadata: "Sign to Close NFT Metadata",
};

/**
 * Create QR code image
 */
APP.get("/qr/:methodName", async (req, res) => {
  console.log("QR code requested:", req.params.methodName, req.query);

  let description = TX_DESCRIPTIONS[req.params.methodName];

  if (description) {
    let buffer = await createQRCodePng(
      req.params.methodName,
      encode(Object(req.query))
    );
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
APP.get("/page/:methodName", async (req, res) => {
  console.log(
    "OpenGraph metapage requested:",
    req.params.methodName,
    req.query
  );

  let description = TX_DESCRIPTIONS[req.params.methodName];
  if (description) {
    res
      .status(200)
      .send(
        createOpenGraphMetaPage(
          req.params.methodName,
          encode(Object(req.query)),
          description
        )
      );
  } else {
    res
      .status(404)
      .send({ error: `Invalid method name ${req.params.methodName}` });
  }
});

/**
 * Solana pay compliant request (GET)
 */
APP.get("/sign/:methodName", async (req, res) => {
  res.status(200).json({
    label: SOLANA_PAY_LABEL,
    icon: "https://solanapay.com/src/img/branding/Solanapay.com/downloads/gradient.svg",
  });
});

/**
 * Solana pay compliant request (POST)
 */
APP.post("/sign/:methodName", async (req, res) => {
  console.log("Tx requested: ", req.params.methodName, req.query);

  let description = TX_DESCRIPTIONS[req.params.methodName];
  if (req.params.methodName === "createBuyNFT") {
    const { buyer, token, price } = req.query;
    const result = await hyperspaceCreateBuyTx(
      buyer as string,
      token as string,
      Number.parseFloat(price as string)
    );
    return res.status(200).json(result);
  } else if (req.params.methodName === "createWriteNFTMetadata") {
    const { image, owner } = req.query;
    const result = await createWriteNFTMetadataTx(CONNECTION, owner as string, {
      image,
    });

    console.log(
      JSON.stringify({
        transaction: result.transaction,
        message: description,
        network: "mainnet-beta",
      })
    );
    return res.status(200).json({
      transaction: result.transaction,
      message: description,
      network: "mainnet-beta",
    });
  } else if (req.params.methodName === "createCloseNFTMetadata") {
    const { account, owner } = req.query;
    const result = await createCloseNFTMetadataTx(
      CONNECTION,
      owner as string,
      account as string
    );
    return res.status(200).json({
      transaction: result.transaction,
      message: description,
      network: "mainnet-beta",
    });
  } else {
    res
      .status(404)
      .send({ error: `Invalid method name ${req.params.methodName}` });
  }
});

function errorHandle(
  handler: (
    req: Request,
    res: Response<any, Record<string, any>>
  ) => Promise<void>
) {
  return (req: Request, res: Response<any, Record<string, any>>) => {
    handler(req, res).catch((error) => {
      console.error(error);

      // Prevent ChatGPT from getting access to error messages until we have a better error handling
      res.status(500).send({ message: "An error occurred" });
    });
  };
}

APP.post("/getBalance", errorHandle(getBalance));
APP.post("/getAccountInfo", errorHandle(getAccountInfo));
APP.post("/getTransaction", errorHandle(getTransaction));
APP.post("/getSignaturesForAddress", errorHandle(getSignaturesForAddress));

APP.post("/getAssetsByOwner", errorHandle(getAssetsByOwner));

APP.post("/:methodName", async (req, res) => {
  // Inspect what ChatGPT is sending
  console.log(req.params.methodName, req.body);

  // Dispatch the request
  try {
    // RPC methods

    // Metaplex ReadAPI methods
    if (req.params.methodName === "getAssetsByOwner") {
    }

    // Write methods
    let description = TX_DESCRIPTIONS[req.params.methodName];
    if (description) {
      let encoded = encode(Object(req.body));
      res.status(200).send({
        linkToSign: `${SELF_URL}/page/${req.params.methodName}?${encoded}`,
      });
    }

    // NFT specific methods - using Hyperspace
    if (req.params.methodName === "getListedCollectionNFTs") {
      const { projectId, pageSize, priceOrder } = req.body;
      const result = await hyperspaceGetListedCollectionNFTs(
        projectId,
        pageSize,
        priceOrder
      );
      return res.status(200).send(JSON.stringify(result));
    } else if (req.params.methodName === "getCollectionsByFloorPrice") {
      const { maxFloorPrice, minFloorPrice, orderBy, pageSize, humanReadable } =
        req.body;
      const result = await hyperspaceGetCollectionsByFloorPrice(
        maxFloorPrice,
        minFloorPrice,
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

APP.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

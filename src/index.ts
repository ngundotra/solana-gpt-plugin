import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";

import * as dotenv from "dotenv";
dotenv.config();

import {
  createWriteNFTMetadataTx,
  createCloseNFTMetadataTx,
} from "./on-chain-metadata/index";
import { getTransaction } from "./handlers/getTransaction";

import configConstants, {
  APP,
  PORT,
  CONNECTION,
  TX_DESCRIPTIONS,
  SOLANA_PAY_LABEL,
  TX_HANDLERS,
} from "./constants";
configConstants();

import { getSignaturesForAddress } from "./handlers/getSignaturesForAddress";
import { getAccountInfo } from "./handlers/getAccountInfo";
import { getBalance } from "./handlers/getBalance";
import { getAssetsByOwner } from "./handlers/getAssetsByOwner";
import { getListedCollectionNFTs } from "./handlers/getListedCollectionNFTs";
import { getCollectionsByFloorPrice } from "./handlers/getCollectionsByFloorPrice";
import { makeRedirectToLinkPreview } from "./handlers/solana-pay/redirectToLinkPreview";
import { makeQrcodeLinkPreview } from "./handlers/solana-pay/qrcodeLinkPreview";
import { makeCreateQrCode } from "./handlers/solana-pay/createQrCode";
import { createBuyNFT } from "./handlers/transaction-handlers/createBuyNFT";

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

function errorHandle(
  handler: (
    req: Request,
    res: Response<any, Record<string, any>>
  ) => Promise<void>
) {
  return (req: Request, res: Response<any, Record<string, any>>) => {
    handler(req, res).catch((error) => {
      console.error(error);

      // Prevent ChatGPT from getting access to error messages until we have better error handling
      res.status(500).send({ message: "An error occurred" });
    });
  };
}

// Solana RPC
APP.post("/getBalance", errorHandle(getBalance));
APP.post("/getAccountInfo", errorHandle(getAccountInfo));
APP.post("/getTransaction", errorHandle(getTransaction));
APP.post("/getSignaturesForAddress", errorHandle(getSignaturesForAddress));

// Metaplex ReadAPI (using Helius)
APP.post("/getAssetsByOwner", errorHandle(getAssetsByOwner));

// NFT Listings (using Hyperspace)
APP.post("/getListedCollectionNFTs", errorHandle(getListedCollectionNFTs));
APP.post(
  "/getCollectionsByFloorPrice",
  errorHandle(getCollectionsByFloorPrice)
);

// Write API
// -> Shows SolanaPay QR code in link previews
for (const methodName of Object.keys(TX_DESCRIPTIONS)) {
  // Create redirect to link preview
  // This is the only ChatGPT accessible endpoint per tx
  APP.post(
    `/${methodName}`,
    errorHandle(makeRedirectToLinkPreview(methodName))
  );

  // ==================================
  //        INTERNAL ENDPOINTS
  // ==================================

  // Creates an OpenGraph HTML page with a link to a QR code
  // so SolanaPay QR Codes can show up in ChatGPT's link previews
  APP.get(
    `/page/${methodName}`,
    errorHandle(makeQrcodeLinkPreview(methodName))
  );

  // Create QR code image
  APP.get(`/qr/${methodName}`, errorHandle(makeCreateQrCode(methodName)));

  // SolanaPay Transaction Request server impl
  // GET - send back store info
  APP.get(`/sign/${methodName}`, async (req, res) => {
    res.status(200).json({
      label: SOLANA_PAY_LABEL,
      icon: "https://solanapay.com/src/img/branding/Solanapay.com/downloads/gradient.svg",
    });
  });

  // POST - send back transaction info
  const txHandler = TX_HANDLERS[methodName];
  APP.post(`/sign/${methodName}`, async (req, res) => {
    console.log("Tx requested: ", methodName, req.query);

    let result = await txHandler(req);
    return res.send(200).json({
      network: "mainnet-beta",
      ...result,
    });
  });
}

APP.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

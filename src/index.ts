import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";

import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

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
  HYPERSPACE_CLIENT,
  TX_DESCRIPTIONS,
  SOLANA_PAY_LABEL,
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

type CreateBuyTxResponse = {
  transaction: string;
};

async function hyperspaceCreateBuyTx(
  buyer: string,
  token: string,
  price: number
): Promise<CreateBuyTxResponse> {
  let transactionData = await HYPERSPACE_CLIENT.createBuyTx({
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
// - Shows SolanaPay QR code in link previews
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
  APP.get(`/sign/${methodName}`, async (req, res) => {
    res.status(200).json({
      label: SOLANA_PAY_LABEL,
      icon: "https://solanapay.com/src/img/branding/Solanapay.com/downloads/gradient.svg",
    });
  });
}

APP.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

import express from "express";
import { Connection } from "@solana/web3.js";
import { HyperspaceClient } from "hyperspace-client-js";

export const APP = express();
export const PORT = process.env.PORT || 3333;

export const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const CONNECTION = new Connection(SOLANA_RPC_URL);

// Internal Solana Pay constants
export const TX_DESCRIPTIONS: Record<string, string> = {
  createBuyNFT: "Sign to Buy NFT",
  createWriteNFTMetadata: "Sign to Write NFT Metadata",
  createCloseNFTMetadata: "Sign to Close NFT Metadata",
};
export const SOLANA_PAY_LABEL = "Solana GPT Plugin";

export let HELIUS_URL: string;
export let SELF_URL: string;
export let HYPERSPACE_CLIENT: HyperspaceClient;

export default function index() {
  HELIUS_URL = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
  if (process.env.DEV === "true") {
    SELF_URL = `http://localhost:${PORT}`;
  } else {
    SELF_URL = "https://solana-gpt-plugin.onrender.com";
  }

  HYPERSPACE_CLIENT = new HyperspaceClient(
    process.env.HYPERSPACE_API_KEY as string
  );
}

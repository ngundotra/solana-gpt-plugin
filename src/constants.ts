import express from "express";
import { Connection } from "@solana/web3.js";

export const APP = express();
export const PORT = process.env.PORT || 3333;

export const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
export const CONNECTION = new Connection(SOLANA_RPC_URL);

export let HELIUS_URL: string;
export let SELF_URL: string;

export default function index() {
  HELIUS_URL = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
  if (process.env.DEV === "true") {
    SELF_URL = `http://localhost:${PORT}`;
  } else {
    SELF_URL = "https://solana-gpt-plugin.onrender.com";
  }
}

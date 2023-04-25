import { Request } from "express";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

export async function createTransferToken(req: Request) {
  const { mint, destination, amount } = req.query;
  const { account: sender } = req.body;

  const sourceToken = getAssociatedTokenAddressSync(
    new PublicKey(mint as string),
    new PublicKey(sender)
  );
  const destinationToken = getAssociatedTokenAddressSync(
    new PublicKey(mint as string),
    new PublicKey(destination as string)
  );

  const tx = new Transaction();
  tx.add(
    createTransferInstruction(
      sourceToken,
      destinationToken,
      sender,
      new BN(amount as string).toNumber()
    )
  );
  return {
    transaction: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
  };
}

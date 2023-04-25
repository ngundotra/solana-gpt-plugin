import { Request, Response } from "express";
import { SOLANA_PAY_LABEL, TX_HANDLERS } from "../../../constants";
import { TransactionHandler } from "../../transaction-handlers";

export async function respondToSolanaPayGet(req: Request, res: Response) {
  res.status(200).json({
    label: SOLANA_PAY_LABEL,
    icon: "https://solanapay.com/src/img/branding/Solanapay.com/downloads/gradient.svg",
  });
}

export function makeRespondToSolanaPayPost(methodName: string) {
  return async (req: Request, res: Response) => {
    console.log("Tx requested: ", methodName, req.query);

    let result = await TX_HANDLERS[methodName](req);
    res.send(200).json({
      network: "mainnet-beta",
      ...result,
    });
  };
}

import { Request } from "express";

import { createCloseNFTMetadataTx } from "../../../on-chain-metadata";
import { CONNECTION } from "../../../constants";

export async function createCloseNFTMetadata(req: Request) {
  const { account, owner } = req.query;
  return await createCloseNFTMetadataTx(
    CONNECTION,
    owner as string,
    account as string
  );
}

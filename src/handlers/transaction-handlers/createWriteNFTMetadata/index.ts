import { Request } from "express";
import { CONNECTION } from "../../../constants";
import { createWriteNFTMetadataTx } from "../../../on-chain-metadata";

export async function createWriteNFTMetadata(req: Request) {
  const { image, owner } = req.query;
  return await createWriteNFTMetadataTx(CONNECTION, owner as string, {
    image,
  });
}

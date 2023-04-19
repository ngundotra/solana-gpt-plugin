import * as anchor from "@coral-xyz/anchor";
import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

type SolanaPayTx = {
  transaction: string;
  message?: string;
};

export async function createWriteNFTMetadataTx(
  owner: string,
  metadata: Object
): Promise<SolanaPayTx> {
  const program = await anchor.Program.at(
    process.env.ON_CHAIN_METADATA_PROGRAM as string,
    new anchor.AnchorProvider(
      new anchor.web3.Connection(process.env.CONNECTION_URL as string),
      new anchor.Wallet(anchor.web3.Keypair.generate()),
      {}
    )
  );

  // await program.methods.createMetadata()
  let metadataBytes = JSON.stringify(metadata);
  console.log(metadataBytes.length);
  if (metadataBytes.length > 500) {
    throw new Error("Metadata too large: " + metadataBytes.length);
  }

  const metadataKp = anchor.web3.Keypair.generate();

  // Create metadata
  let initIx = await program.methods
    .initialize(new anchor.BN(metadataBytes.length))
    .accounts({
      owner,
      metadata: metadataKp.publicKey,
    })
    .signers([metadataKp])
    .instruction();

  // Write metadata
  let writeIx = await program.methods
    .write(new anchor.BN(0), Buffer.from(metadataBytes))
    .accounts({
      metadata: metadataKp.publicKey,
      owner,
    })
    .instruction();

  // Validate metadata
  let validateIx = await program.methods
    .validate()
    .accounts({ metadata: metadataKp.publicKey })
    .instruction();

  let tx = new anchor.web3.Transaction();
  tx = tx.add(initIx).add(writeIx).add(validateIx);
  tx.partialSign(metadataKp);

  return {
    transaction: base64.encode(tx.serialize()),
  };
}

export async function createCloseNFTMetadataTx(
  owner: string,
  account: string
): Promise<SolanaPayTx> {
  const program = await anchor.Program.at(
    process.env.ON_CHAIN_METADATA_PROGRAM as string,
    new anchor.AnchorProvider(
      new anchor.web3.Connection(process.env.CONNECTION_URL as string),
      new anchor.Wallet(anchor.web3.Keypair.generate()),
      {}
    )
  );

  let tx = await program.methods
    .close()
    .accounts({
      metadata: account,
      recipient: owner,
      owner,
    })
    .transaction();

  return {
    transaction: base64.encode(tx.serialize()),
  };
}

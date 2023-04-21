import * as anchor from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { base64 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const connection = new anchor.web3.Connection(SOLANA_RPC_URL);

type SolanaPayTx = {
  transaction: string;
  message?: string;
};

/**
 * Need this to fake a wallet with only a publicKey for the anchor provider
 */
class FakeWallet {
  publicKey: anchor.web3.PublicKey;
  constructor(publicKey: anchor.web3.PublicKey) {
    this.publicKey = publicKey;
  }

  async signTransaction<
    T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction
  >(tx: T): Promise<T> {
    return tx;
  }

  async signAllTransactions<
    T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction
  >(txs: T[]): Promise<T[]> {
    return txs;
  }
}

export async function createWriteNFTMetadataTx(
  owner: string,
  metadata: Object
): Promise<SolanaPayTx> {
  const program = await anchor.Program.at(
    process.env.ON_CHAIN_METADATA_PROGRAM as string,
    new anchor.AnchorProvider(
      connection,
      new FakeWallet(new anchor.web3.PublicKey(owner)),
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
  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  tx.feePayer = new anchor.web3.PublicKey(owner);
  tx.partialSign(metadataKp);

  return {
    transaction: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
  };
}

export async function createCloseNFTMetadataTx(
  owner: string,
  account: string
): Promise<SolanaPayTx> {
  const program = await anchor.Program.at(
    process.env.ON_CHAIN_METADATA_PROGRAM as string,
    new anchor.AnchorProvider(
      connection,
      new FakeWallet(new anchor.web3.PublicKey(owner)),
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

  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
  tx.feePayer = new anchor.web3.PublicKey(owner);

  return {
    transaction: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
  };
}

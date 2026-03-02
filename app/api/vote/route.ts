// =============================================================================
// Solana Action — Vote instruction
// =============================================================================
//
// This file implements a Solana Action, which is a standard HTTP API that
// returns a ready-to-sign Solana transaction. Action clients (wallets, Dialect,
// Twitter/X via Blinks) call:
//
//   GET  /api/vote?pollId=1          → returns the blink UI metadata
//   POST /api/vote?pollId=1&candidate=Alice  → returns a serialized transaction
//
// The OPTIONS handler mirrors GET to satisfy browser CORS preflight requests.
// All responses must include ACTIONS_CORS_HEADERS for blink clients to accept them.
// =============================================================================

import {
  ActionGetResponse,
  ActionPostRequest,
  ACTIONS_CORS_HEADERS,
  createPostResponse,
} from "@solana/actions";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { Voting } from "@/anchor/target/types/voting";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

const IDL = require("@/anchor/target/idl/voting.json");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// RPC endpoint — uses the env var if set (e.g. for a private RPC on Mainnet),
// falls back to the public Solana devnet endpoint.
// To run against a local validator instead, set:
//   NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

// The candidates available in this poll.
// In a production app you'd fetch these on-chain by reading Candidate PDAs.
// For this demo they are fixed and must match what was registered via
// initialize_candidate on-chain.
const VALID_CANDIDATES = ["Alice", "Bob"] as const;
type Candidate = (typeof VALID_CANDIDATES)[number];

// ---------------------------------------------------------------------------
// GET — blink UI metadata
// ---------------------------------------------------------------------------
// Blink clients call this first to render the voting card UI (icon, title,
// description, and a button per candidate).

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pollId = searchParams.get("pollId") ?? "1";

  const payload: ActionGetResponse = {
    // A square image shown as the blink card thumbnail.
    // Replace with your own hosted image for production.
    icon: "https://img.freepik.com/free-vector/male-female-user-circles-flat-set_78370-4713.jpg",
    title: `Vote on Poll #${pollId}`,
    description:
      "Cast your on-chain vote. Each click builds and sends a Solana transaction " +
      "signed by your wallet — no backend holds your keys.",
    label: "Vote",
    links: {
      // Each entry renders as a separate button in the blink UI.
      // The href is the POST endpoint that will be called when the button is clicked.
      actions: VALID_CANDIDATES.map((candidate) => ({
        label: `Vote for ${candidate}`,
        href: `/api/vote?pollId=${pollId}&candidate=${candidate}`,
        type: "transaction" as const,
      })),
    },
  };

  return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

// The OPTIONS export makes CORS preflight requests work for both GET and POST.
export const OPTIONS = GET;

// ---------------------------------------------------------------------------
// POST — build and return the vote transaction
// ---------------------------------------------------------------------------
// The blink client sends the voter's public key in the request body.
// We use the Anchor program client to derive the correct PDAs and build the
// vote instruction, then wrap it in a transaction for the client to sign.

export const POST = async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const pollIdParam = searchParams.get("pollId") ?? "1";
  const candidateName = searchParams.get("candidate") ?? "";

  // --- Input validation ---

  // Reject any candidate not in our known list to prevent crafted requests
  // from calling the vote instruction with arbitrary names.
  if (!VALID_CANDIDATES.includes(candidateName as Candidate)) {
    return new Response(
      JSON.stringify({ error: `Invalid candidate. Must be one of: ${VALID_CANDIDATES.join(", ")}` }),
      { status: 400, headers: ACTIONS_CORS_HEADERS }
    );
  }

  // Parse the voter's public key from the request body.
  // The blink client always sends { account: "<base58 pubkey>" }.
  const body: ActionPostRequest = await req.json();
  let voterPublicKey: PublicKey;
  try {
    voterPublicKey = new PublicKey(body.account);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid voter public key" }),
      { status: 400, headers: ACTIONS_CORS_HEADERS }
    );
  }

  // --- Build the transaction ---

  // Connect to the cluster. Anchor's Program client uses this to resolve PDAs
  // and fetch account info needed to build the instruction.
  const connection = new Connection(RPC_URL, "confirmed");

  // Instantiate the Anchor program client (read-only — no wallet needed here
  // because we're only building, not signing, the transaction).
  const program: Program<Voting> = new Program(IDL, { connection });

  // program.methods.vote() automatically:
  //   1. Encodes the discriminator + Borsh-serialized arguments
  //   2. Derives the poll and candidate PDAs from the seeds in the IDL
  //   3. Returns a TransactionInstruction ready to be added to a Transaction
  const instruction = await program.methods
    .vote(candidateName, new anchor.BN(pollIdParam))
    .accounts({
      signer: voterPublicKey, // The voter — Anchor resolves poll + candidate PDAs automatically
    })
    .instruction();

  // Fetch a recent blockhash so the transaction doesn't expire before the
  // user signs and the client submits it.
  const blockHash = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: voterPublicKey,          // The voter pays the transaction fee (~0.000005 SOL)
    blockhash: blockHash.blockhash,
    lastValidBlockHeight: blockHash.lastValidBlockHeight,
  }).add(instruction);

  // createPostResponse serializes the transaction to base64 in the format
  // that blink clients expect. The client deserializes it, asks the user's
  // wallet to sign, and submits it to the cluster.
  const response = await createPostResponse({
    fields: {
      transaction,
      type: "transaction",
    },
  });

  return Response.json(response, { headers: ACTIONS_CORS_HEADERS });
};

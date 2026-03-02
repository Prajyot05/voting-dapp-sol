// ============================================================================
// Voting Program — A Solana on-chain voting system built with Anchor
// ============================================================================
//
// This program lets anyone:
//   1. Create a poll (with a description, start/end timestamps)
//   2. Register candidates under a poll
//   3. Cast votes for candidates
//
// Key Solana / Anchor concepts used:
//   - Program Derived Addresses (PDAs) for deterministic account creation
//   - The `init` constraint to create accounts and pay rent
//   - Seeds & bumps for PDA derivation
//   - `#[instruction(...)]` to access instruction args inside account structs
//   - Borsh serialization (automatic via `#[account]`)
//   - `InitSpace` derive macro to auto-calculate account size
//.  - The System Program is a built-in Solana program that ships with every validator. Its address is always 11111111111111111111111111111111.
//     It is the only program on Solana that can:
//     1. Create a new account (allocate space on-chain)
//     2. Transfer SOL between accounts
// ============================================================================

use anchor_lang::prelude::*;

// Include the test module only when running `cargo test`. This is the standard Rust pattern for keeping test code out of your production binary.
#[cfg(test)]
mod tests; // Because there is no { } body here, Rust treats this as an inline module declaration with an external file — it looks for the module's source in a file named tests.rs in the same directory.

// The on-chain program ID. This must match what's in Anchor.toml and the
// deployed keypair. `declare_id!` also creates a constant `ID` (or `crate::ID`)
// that can be referenced in tests or other modules.
declare_id!("DHt4nNcMmkc1BGtkxPyPJm656ScJdrcQJzPhsLURTEY3");

// ============================================================================
// Instructions (the program's public API)
// ============================================================================
//
// The `#[program]` macro turns this module into the entrypoint of the Solana
// program. Each public function becomes an instruction that clients can call.
// Anchor auto-generates an 8-byte discriminator for each instruction by hashing
// "global:<instruction_name>" — this is how the runtime routes calls.
#[program]
pub mod voting {
    use super::*;

    /// Creates a new poll account.
    ///
    /// The poll PDA is derived from seeds: ["poll", poll_id (as LE bytes)].
    /// Because `init` is used, calling this twice with the same poll_id will
    /// fail (the PDA account already exists), preventing duplicates.
    ///
    /// # Arguments
    /// * `poll_id`     — Unique numeric identifier for this poll
    /// * `description` — Human-readable description (max 280 chars, like a tweet)
    /// * `poll_start`  — Unix timestamp when voting opens
    /// * `poll_end`    — Unix timestamp when voting closes
    pub fn initialize_poll(ctx: Context<InitializePoll>,
                            poll_id: u64,
                            description: String,
                            poll_start: u64,
                            poll_end: u64) -> Result<()> {
        // `ctx.accounts.poll` is the newly created PDA account.
        // We get a mutable reference so we can write its fields.
        let poll = &mut ctx.accounts.poll;
        poll.poll_id = poll_id;
        poll.description = description;
        poll.poll_start = poll_start;
        poll.poll_end = poll_end;
        poll.candidate_amount = 0; // No candidates registered yet
        Ok(())
    }

    /// Registers a new candidate under an existing poll.
    ///
    /// The candidate PDA is derived from seeds: [poll_id (LE bytes), candidate_name (bytes)].
    /// This means each candidate name is unique *per poll*.
    /// The poll's `candidate_amount` counter is also incremented.
    ///
    /// # Arguments
    /// * `candidate_name` — The candidate's display name (max 32 chars)
    /// * `_poll_id`       — The poll to register under (prefixed with _ because
    ///                       it's only used in the account constraints, not here)
    pub fn initialize_candidate(ctx: Context<InitializeCandidate>, candidate_name: String, _poll_id: u64) -> Result<()> {
        let candidate = &mut ctx.accounts.candidate;
        let poll = &mut ctx.accounts.poll;
        // Increment the poll's candidate counter so we can track how many
        // candidates are registered without iterating all accounts.
        poll.candidate_amount += 1;
        candidate.candidate_name = candidate_name;
        candidate.candidate_votes = 0; // Start with zero votes
        Ok(())
    }

    /// Casts one vote for a candidate in a poll.
    ///
    /// Creates a `VoteReceipt` PDA derived from ["receipt", poll_id, voter_pubkey].
    /// Because `init` is used for that account, a second vote attempt from the
    /// same wallet on the same poll will fail — the receipt account already exists.
    ///
    /// # Arguments
    /// * `_candidate_name` — Used only in account constraints for PDA derivation
    /// * `_poll_id`        — Used only in account constraints for PDA derivation
    pub fn vote(ctx: Context<Vote>, _candidate_name: String, _poll_id: u64) -> Result<()> {
        let candidate = &mut ctx.accounts.candidate;
        candidate.candidate_votes += 1;

        // Record the receipt so this wallet cannot vote again on the same poll.
        let receipt = &mut ctx.accounts.vote_receipt;
        receipt.voter = ctx.accounts.signer.key();
        receipt.poll_id = _poll_id;
        Ok(())
    }
}

// ============================================================================
// Account Structs (define what accounts each instruction expects)
// ============================================================================
//
// Each struct marked with `#[derive(Accounts)]` tells Anchor which accounts
// the instruction needs, their types, constraints, and relationships.

/// Accounts required by the `vote` instruction.
#[derive(Accounts)]
// The `#[instruction(...)]` attribute lets us access instruction arguments
// (like poll_id) inside the account validation constraints (like PDA seeds).
// IMPORTANT: the parameter order in #[instruction(...)] must match the
// function signature.
#[instruction(candidate_name: String, poll_id: u64)]
pub struct Vote<'info> {
    // The voter — `mut` because SOL is deducted to fund the receipt account.
    #[account(mut)]
    pub signer: Signer<'info>,

    // The poll account — read-only, used to verify the poll exists.
    #[account(
        seeds = [b"poll", poll_id.to_le_bytes().as_ref()],
        bump
    )]
    pub poll: Account<'info, Poll>,

    // The candidate to vote for — `mut` because we increment vote count.
    #[account(
        mut,
        seeds = [poll_id.to_le_bytes().as_ref(), candidate_name.as_bytes()],
        bump
    )]
    pub candidate: Account<'info, Candidate>,

    // Voter receipt — created here with `init`, so a second vote attempt from
    // the same wallet on the same poll will fail because this account already
    // exists. Seeds: ["receipt", poll_id (LE), voter_pubkey].
    #[account(
        init,
        payer = signer,
        space = 8 + VoteReceipt::INIT_SPACE,
        seeds = [b"receipt", poll_id.to_le_bytes().as_ref(), signer.key().as_ref()],
        bump
    )]
    pub vote_receipt: Account<'info, VoteReceipt>,

    // Required because `init` makes a CPI call to the System Program.
    pub system_program: Program<'info, System>,
}

/// Accounts required by the `initialize_candidate` instruction.
#[derive(Accounts)]
#[instruction(candidate_name: String, poll_id: u64)]
pub struct InitializeCandidate<'info> {
    // The payer — `mut` because SOL will be deducted to pay rent for the
    // new candidate account.
    #[account(mut)]
    pub signer: Signer<'info>,

    // The poll this candidate belongs to — `mut` because we increment
    // `candidate_amount`.
    // NOTE: seeds must include b"poll" to match how InitializePoll created it.
    #[account(
        mut,
        seeds = [b"poll", poll_id.to_le_bytes().as_ref()],
        bump
    )]
    pub poll: Account<'info, Poll>,

    // The new candidate account — `init` creates it on-chain.
    // `payer = signer` means the signer pays the rent-exempt minimum.
    // `space = 8 + Candidate::INIT_SPACE`:
    //   - 8 bytes = Anchor's account discriminator (identifies the account type)
    //   - INIT_SPACE = auto-calculated from the struct fields
    // `seeds` derive a unique PDA per (poll_id, candidate_name) pair.
    #[account(
        init, // When you write init in an #[account(...)] constraint, Anchor automatically generates the CPI call to the System Program on your behalf. That's why you must include system_program in the accounts struct — Anchor needs a validated reference to it to make that call.
        payer = signer,
        space = 8 + Candidate::INIT_SPACE,
        seeds = [poll_id.to_le_bytes().as_ref(), candidate_name.as_bytes()],
        bump
    )]
    pub candidate: Account<'info, Candidate>,

    // Since we are using `init`.
    pub system_program: Program<'info, System>
}

/// Accounts required by the `initialize_poll` instruction.
#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct InitializePoll<'info> {
    // The payer — `mut` because SOL is deducted to fund the new poll account.
    #[account(mut)]
    pub signer: Signer<'info>,

    // The new poll account. Uses `init` to create it with these seeds:
    //   - b"poll" — a static string prefix (avoids collisions with candidate PDAs)
    //   - poll_id as little-endian bytes — makes each poll_id unique
    // If someone tries to call initialize_poll with the same poll_id twice,
    // Anchor will see the PDA already exists and reject the transaction.
    #[account(
        init,
        payer = signer,
        space = 8 + Poll::INIT_SPACE,
        seeds = [b"poll", poll_id.to_le_bytes().as_ref()],
        bump
    )]
    pub poll: Account<'info, Poll>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// Data Accounts (the on-chain state)
// ============================================================================
//
// `#[account]` makes the struct serializable with Borsh and adds an 8-byte
// discriminator prefix so Anchor can verify account types at runtime.
//
// `#[derive(InitSpace)]` auto-calculates the space needed for each field:
//   - u64 = 8 bytes
//   - String with #[max_len(N)] = 4 bytes (length prefix) + N bytes
//
// The total account size passed to `init` is always 8 (discriminator) + INIT_SPACE.

/// Stores the state of a single poll.
#[account]
#[derive(InitSpace)]
pub struct Poll {
    pub poll_id: u64,           // 8 bytes — unique identifier
    #[max_len(280)]
    pub description: String,    // 4 + 280 = 284 bytes — poll description
    pub poll_start: u64,        // 8 bytes — voting start timestamp
    pub poll_end: u64,          // 8 bytes — voting end timestamp
    pub candidate_amount: u64   // 8 bytes — number of registered candidates
}

/// Stores the state of a single candidate within a poll.
#[account]
#[derive(InitSpace)]
pub struct Candidate {
    #[max_len(32)]
    pub candidate_name: String,  // 4 + 32 = 36 bytes — candidate name
    pub candidate_votes: u64     // 8 bytes — total votes received
}

/// A zero-data marker account proving that a wallet already voted in a poll.
///
/// It is created (via `init`) inside the `vote` instruction and is derived
/// from seeds ["receipt", poll_id (LE-u64), voter_pubkey].
/// Attempting to vote a second time will fail because `init` rejects
/// creation of an account that already exists.
#[account]
#[derive(InitSpace)]
pub struct VoteReceipt {
    // Storing the voter and poll lets us inspect receipts off-chain if needed.
    pub voter: Pubkey,  // 32 bytes
    pub poll_id: u64,  // 8 bytes
}
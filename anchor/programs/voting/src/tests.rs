// ============================================================================
// Tests for the Voting Program using LiteSVM
// ============================================================================
//
// LiteSVM is a lightweight Solana Virtual Machine that runs entirely in-process.
// Unlike `solana-test-validator`, there's no need to start a separate process —
// tests are fast and self-contained.
//
// Since we're testing an Anchor program from Rust (not TypeScript), we need to
// manually construct the instruction data in the same format Anchor expects:
//   [8-byte discriminator] [borsh-serialized arguments]
//
// The discriminator is the first 8 bytes of sha256("global:<instruction_name>").
// These were extracted from the generated IDL (target/idl/voting.json).
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::ID as PROGRAM_ID;
    use litesvm::LiteSVM;
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::Keypair,
        signer::Signer,
        system_program,
        transaction::Transaction,
    };

    // ========================================================================
    // Anchor instruction discriminators (from the IDL)
    // ========================================================================
    // These are the first 8 bytes of sha256("global:<fn_name>").
    // They tell the Anchor program which instruction to execute.

    const INITIALIZE_POLL_DISCRIMINATOR: [u8; 8] = [193, 22, 99, 197, 18, 33, 115, 117];
    const INITIALIZE_CANDIDATE_DISCRIMINATOR: [u8; 8] = [210, 107, 118, 204, 255, 97, 112, 26];
    const VOTE_DISCRIMINATOR: [u8; 8] = [227, 110, 155, 23, 136, 126, 172, 25];

    // ========================================================================
    // PDA derivation helpers
    // ========================================================================
    // PDAs (Program Derived Addresses) are deterministic addresses derived from
    // seeds + the program ID. They don't have a private key, so only the
    // program itself can "sign" for them (via CPI invoke_signed).

    /// Derives the Poll PDA for `initialize_poll`.
    /// Seeds: ["poll", poll_id as LE bytes] — note the "poll" prefix.
    fn get_poll_pda(poll_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"poll", &poll_id.to_le_bytes()],
            &PROGRAM_ID,
        )
    }

    /// Derives the Candidate PDA. Seeds: [poll_id as LE bytes, candidate_name as bytes]
    fn get_candidate_pda(poll_id: u64, candidate_name: &str) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[&poll_id.to_le_bytes(), candidate_name.as_bytes()],
            &PROGRAM_ID,
        )
    }

    // ========================================================================
    // Instruction builders
    // ========================================================================
    // Each function constructs a Solana Instruction with:
    //   - The correct program_id
    //   - The accounts the instruction expects (in the same order as the struct)
    //   - The serialized data: [discriminator][borsh-encoded args]
    //
    // Borsh encoding rules:
    //   - u64 → 8 bytes little-endian
    //   - String → 4-byte LE length prefix + UTF-8 bytes

    /// Builds an `initialize_poll` instruction.
    fn create_initialize_poll_ix(
        signer: &Pubkey,
        poll_pda: &Pubkey,
        poll_id: u64,
        description: &str,
        poll_start: u64,
        poll_end: u64,
    ) -> Instruction {
        let mut data = INITIALIZE_POLL_DISCRIMINATOR.to_vec();
        // Arg 1: poll_id (u64 LE)
        data.extend_from_slice(&poll_id.to_le_bytes());
        // Arg 2: description (Borsh String = u32 length + bytes)
        let desc_bytes = description.as_bytes();
        data.extend_from_slice(&(desc_bytes.len() as u32).to_le_bytes());
        data.extend_from_slice(desc_bytes);
        // Arg 3: poll_start (u64 LE)
        data.extend_from_slice(&poll_start.to_le_bytes());
        // Arg 4: poll_end (u64 LE)
        data.extend_from_slice(&poll_end.to_le_bytes());

        Instruction {
            program_id: PROGRAM_ID,
            // Accounts must match InitializePoll struct order:
            //   1. signer (writable, signer) — pays rent
            //   2. poll (writable) — the PDA being created
            //   3. system_program (readonly) — needed for account creation
            accounts: vec![
                AccountMeta::new(*signer, true),
                AccountMeta::new(*poll_pda, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    /// Builds an `initialize_candidate` instruction.
    fn create_initialize_candidate_ix(
        signer: &Pubkey,
        poll_pda: &Pubkey,
        candidate_pda: &Pubkey,
        candidate_name: &str,
        poll_id: u64,
    ) -> Instruction {
        let mut data = INITIALIZE_CANDIDATE_DISCRIMINATOR.to_vec();
        // Arg 1: candidate_name (Borsh String)
        let name_bytes = candidate_name.as_bytes();
        data.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
        data.extend_from_slice(name_bytes);
        // Arg 2: poll_id (u64 LE) — prefixed with _ in the program but still passed
        data.extend_from_slice(&poll_id.to_le_bytes());

        Instruction {
            program_id: PROGRAM_ID,
            // Accounts must match InitializeCandidate struct order:
            //   1. signer (writable, signer) — pays rent
            //   2. poll (writable) — to increment candidate_amount
            //   3. candidate (writable) — the PDA being created
            //   4. system_program (readonly) — needed for account creation
            accounts: vec![
                AccountMeta::new(*signer, true),
                AccountMeta::new(*poll_pda, false),
                AccountMeta::new(*candidate_pda, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    /// Builds a `vote` instruction.
    fn create_vote_ix(
        signer: &Pubkey,
        poll_pda: &Pubkey,
        candidate_pda: &Pubkey,
        candidate_name: &str,
        poll_id: u64,
    ) -> Instruction {
        let mut data = VOTE_DISCRIMINATOR.to_vec();
        // Arg 1: candidate_name (Borsh String)
        let name_bytes = candidate_name.as_bytes();
        data.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
        data.extend_from_slice(name_bytes);
        // Arg 2: poll_id (u64 LE)
        data.extend_from_slice(&poll_id.to_le_bytes());

        Instruction {
            program_id: PROGRAM_ID,
            // Accounts must match Vote struct order:
            //   1. signer (readonly, signer) — the voter
            //   2. poll (readonly) — verified via PDA seeds
            //   3. candidate (writable) — to increment vote count
            accounts: vec![
                AccountMeta::new_readonly(*signer, true),
                AccountMeta::new_readonly(*poll_pda, false),
                AccountMeta::new(*candidate_pda, false),
            ],
            data,
        }
    }

    // ========================================================================
    // Helper: send a transaction and return the result
    // ========================================================================

    /// Convenience wrapper: signs and sends a single-instruction transaction.
    fn send_ix(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair) -> Result<(), litesvm::types::FailedTransactionMetadata> {
        let blockhash = svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[payer],
            blockhash,
        );
        svm.send_transaction(tx)
            .map(|_| ())
    }

    // ========================================================================
    // Helper: set up a fresh SVM with the program loaded and a funded user
    // ========================================================================

    fn setup() -> (LiteSVM, Keypair) {
        let mut svm = LiteSVM::new();
        // Load the compiled program binary (built by `anchor build`)
        let program_bytes = include_bytes!("../../../target/deploy/voting.so");
        svm.add_program(PROGRAM_ID, program_bytes);

        // Create a test user and give them SOL for transaction fees + rent
        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 5_000_000_000).unwrap(); // 5 SOL
        (svm, user)
    }

    // ========================================================================
    // Account data parsing helpers
    // ========================================================================
    // Anchor stores accounts as: [8-byte discriminator][borsh-serialized fields]
    // We parse the raw bytes to verify on-chain state.

    /// Parse a Poll account's fields from raw account data.
    /// Returns (poll_id, description, poll_start, poll_end, candidate_amount).
    fn parse_poll_data(data: &[u8]) -> (u64, String, u64, u64, u64) {
        // Skip 8-byte discriminator
        let poll_id = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let desc_len = u32::from_le_bytes(data[16..20].try_into().unwrap()) as usize;
        let description = std::str::from_utf8(&data[20..20 + desc_len]).unwrap().to_string();
        let offset = 20 + desc_len;
        let poll_start = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
        let poll_end = u64::from_le_bytes(data[offset + 8..offset + 16].try_into().unwrap());
        let candidate_amount = u64::from_le_bytes(data[offset + 16..offset + 24].try_into().unwrap());
        (poll_id, description, poll_start, poll_end, candidate_amount)
    }

    /// Parse a Candidate account's fields from raw account data.
    /// Returns (candidate_name, candidate_votes).
    fn parse_candidate_data(data: &[u8]) -> (String, u64) {
        // Skip 8-byte discriminator
        let name_len = u32::from_le_bytes(data[8..12].try_into().unwrap()) as usize;
        let name = std::str::from_utf8(&data[12..12 + name_len]).unwrap().to_string();
        let votes = u64::from_le_bytes(data[12 + name_len..12 + name_len + 8].try_into().unwrap());
        (name, votes)
    }

    // ========================================================================
    // Tests
    // ========================================================================

    #[test]
    fn test_initialize_poll() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let description = "What is your favourite colour?";
        let poll_start: u64 = 1_000_000;
        let poll_end: u64 = 2_000_000;
        let (poll_pda, _) = get_poll_pda(poll_id);

        // Create the poll
        let ix = create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, description, poll_start, poll_end,
        );
        send_ix(&mut svm, ix, &user).expect("initialize_poll should succeed");

        // Verify on-chain state
        let account = svm.get_account(&poll_pda).expect("poll account should exist");
        let (stored_id, stored_desc, stored_start, stored_end, stored_candidates) =
            parse_poll_data(&account.data);

        assert_eq!(stored_id, poll_id);
        assert_eq!(stored_desc, description);
        assert_eq!(stored_start, poll_start);
        assert_eq!(stored_end, poll_end);
        assert_eq!(stored_candidates, 0, "new poll should have 0 candidates");
    }

    #[test]
    fn test_initialize_poll_duplicate_fails() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let (poll_pda, _) = get_poll_pda(poll_id);

        // First call succeeds
        let ix = create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "First poll", 0, 1_000_000,
        );
        send_ix(&mut svm, ix, &user).expect("first initialize_poll should succeed");

        // Second call with same poll_id should fail (PDA already exists)
        let ix2 = create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "Duplicate", 0, 1_000_000,
        );
        let result = send_ix(&mut svm, ix2, &user);
        assert!(result.is_err(), "duplicate initialize_poll should fail");
    }

    #[test]
    fn test_initialize_candidate() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let candidate_name = "Alice";
        let (poll_pda, _) = get_poll_pda(poll_id);
        let (candidate_pda, _) = get_candidate_pda(poll_id, candidate_name);

        // First create the poll
        let poll_ix = create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "Best candidate?", 0, 1_000_000,
        );
        send_ix(&mut svm, poll_ix, &user).expect("initialize_poll should succeed");

        // Then register a candidate
        let candidate_ix = create_initialize_candidate_ix(
            &user.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        );
        send_ix(&mut svm, candidate_ix, &user).expect("initialize_candidate should succeed");

        // Verify candidate account
        let account = svm.get_account(&candidate_pda).expect("candidate account should exist");
        let (stored_name, stored_votes) = parse_candidate_data(&account.data);
        assert_eq!(stored_name, candidate_name);
        assert_eq!(stored_votes, 0, "new candidate should have 0 votes");

        // Verify poll's candidate_amount was incremented
        let poll_account = svm.get_account(&poll_pda).unwrap();
        let (_, _, _, _, candidate_amount) = parse_poll_data(&poll_account.data);
        assert_eq!(candidate_amount, 1, "poll should have 1 candidate");
    }

    #[test]
    fn test_initialize_multiple_candidates() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let (poll_pda, _) = get_poll_pda(poll_id);

        // Create poll
        let poll_ix = create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "Favourite fruit?", 0, 1_000_000,
        );
        send_ix(&mut svm, poll_ix, &user).unwrap();

        // Register 3 candidates
        let names = ["Apple", "Banana", "Cherry"];
        for name in &names {
            let (c_pda, _) = get_candidate_pda(poll_id, name);
            let ix = create_initialize_candidate_ix(
                &user.pubkey(), &poll_pda, &c_pda, name, poll_id,
            );
            send_ix(&mut svm, ix, &user)
                .unwrap_or_else(|_| panic!("should register candidate '{}'", name));
        }

        // Verify poll's candidate_amount is 3
        let poll_account = svm.get_account(&poll_pda).unwrap();
        let (_, _, _, _, candidate_amount) = parse_poll_data(&poll_account.data);
        assert_eq!(candidate_amount, 3, "poll should have 3 candidates");

        // Verify each candidate exists with 0 votes
        for name in &names {
            let (c_pda, _) = get_candidate_pda(poll_id, name);
            let account = svm.get_account(&c_pda).unwrap();
            let (stored_name, stored_votes) = parse_candidate_data(&account.data);
            assert_eq!(stored_name, *name);
            assert_eq!(stored_votes, 0);
        }
    }

    #[test]
    fn test_initialize_duplicate_candidate_fails() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let candidate_name = "Alice";
        let (poll_pda, _) = get_poll_pda(poll_id);
        let (candidate_pda, _) = get_candidate_pda(poll_id, candidate_name);

        // Create poll + first candidate
        let poll_ix = create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "Test poll", 0, 1_000_000,
        );
        send_ix(&mut svm, poll_ix, &user).unwrap();

        let c_ix = create_initialize_candidate_ix(
            &user.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        );
        send_ix(&mut svm, c_ix, &user).unwrap();

        // Registering the same candidate again should fail (PDA already exists)
        let c_ix2 = create_initialize_candidate_ix(
            &user.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        );
        let result = send_ix(&mut svm, c_ix2, &user);
        assert!(result.is_err(), "duplicate candidate should fail");
    }

    #[test]
    fn test_vote() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let candidate_name = "Alice";
        let (poll_pda, _) = get_poll_pda(poll_id);
        let (candidate_pda, _) = get_candidate_pda(poll_id, candidate_name);

        // Setup: create poll and candidate
        send_ix(&mut svm, create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "Vote test", 0, 1_000_000,
        ), &user).unwrap();
        send_ix(&mut svm, create_initialize_candidate_ix(
            &user.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        ), &user).unwrap();

        // Cast a vote
        let vote_ix = create_vote_ix(
            &user.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        );
        send_ix(&mut svm, vote_ix, &user).expect("vote should succeed");

        // Verify vote count is now 1
        let account = svm.get_account(&candidate_pda).unwrap();
        let (_, votes) = parse_candidate_data(&account.data);
        assert_eq!(votes, 1, "candidate should have 1 vote");
    }

    #[test]
    fn test_multiple_votes() {
        let (mut svm, user) = setup();

        let poll_id: u64 = 1;
        let (poll_pda, _) = get_poll_pda(poll_id);
        let (alice_pda, _) = get_candidate_pda(poll_id, "Alice");
        let (bob_pda, _) = get_candidate_pda(poll_id, "Bob");

        // Setup: poll + two candidates
        send_ix(&mut svm, create_initialize_poll_ix(
            &user.pubkey(), &poll_pda, poll_id, "Multi-vote test", 0, 1_000_000,
        ), &user).unwrap();
        send_ix(&mut svm, create_initialize_candidate_ix(
            &user.pubkey(), &poll_pda, &alice_pda, "Alice", poll_id,
        ), &user).unwrap();
        send_ix(&mut svm, create_initialize_candidate_ix(
            &user.pubkey(), &poll_pda, &bob_pda, "Bob", poll_id,
        ), &user).unwrap();

        // Vote for Alice 3 times, Bob 1 time
        // We expire the blockhash between identical votes to avoid "AlreadyProcessed"
        // errors (same instruction + same blockhash = same tx signature).
        for _ in 0..3 {
            svm.expire_blockhash();
            send_ix(&mut svm, create_vote_ix(
                &user.pubkey(), &poll_pda, &alice_pda, "Alice", poll_id,
            ), &user).unwrap();
        }
        send_ix(&mut svm, create_vote_ix(
            &user.pubkey(), &poll_pda, &bob_pda, "Bob", poll_id,
        ), &user).unwrap();

        // Verify final vote counts
        let alice_account = svm.get_account(&alice_pda).unwrap();
        let (_, alice_votes) = parse_candidate_data(&alice_account.data);
        assert_eq!(alice_votes, 3, "Alice should have 3 votes");

        let bob_account = svm.get_account(&bob_pda).unwrap();
        let (_, bob_votes) = parse_candidate_data(&bob_account.data);
        assert_eq!(bob_votes, 1, "Bob should have 1 vote");
    }

    #[test]
    fn test_vote_with_different_users() {
        let (mut svm, user1) = setup();

        // Create a second user
        let user2 = Keypair::new();
        svm.airdrop(&user2.pubkey(), 5_000_000_000).unwrap();

        let poll_id: u64 = 1;
        let candidate_name = "Alice";
        let (poll_pda, _) = get_poll_pda(poll_id);
        let (candidate_pda, _) = get_candidate_pda(poll_id, candidate_name);

        // User1 creates poll and candidate
        send_ix(&mut svm, create_initialize_poll_ix(
            &user1.pubkey(), &poll_pda, poll_id, "Multi-user voting", 0, 1_000_000,
        ), &user1).unwrap();
        send_ix(&mut svm, create_initialize_candidate_ix(
            &user1.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        ), &user1).unwrap();

        // Both users vote for Alice
        send_ix(&mut svm, create_vote_ix(
            &user1.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        ), &user1).expect("user1 vote should succeed");
        send_ix(&mut svm, create_vote_ix(
            &user2.pubkey(), &poll_pda, &candidate_pda, candidate_name, poll_id,
        ), &user2).expect("user2 vote should succeed");

        // Verify vote count is 2
        let account = svm.get_account(&candidate_pda).unwrap();
        let (_, votes) = parse_candidate_data(&account.data);
        assert_eq!(votes, 2, "candidate should have 2 votes from different users");
    }

    #[test]
    fn test_separate_polls_are_independent() {
        let (mut svm, user) = setup();

        // Create two separate polls
        let (poll1_pda, _) = get_poll_pda(1);
        let (poll2_pda, _) = get_poll_pda(2);

        send_ix(&mut svm, create_initialize_poll_ix(
            &user.pubkey(), &poll1_pda, 1, "Poll One", 0, 1_000_000,
        ), &user).unwrap();
        send_ix(&mut svm, create_initialize_poll_ix(
            &user.pubkey(), &poll2_pda, 2, "Poll Two", 0, 1_000_000,
        ), &user).unwrap();

        // Same candidate name "Alice" in both polls — should be separate PDAs
        let (alice_poll1, _) = get_candidate_pda(1, "Alice");
        let (alice_poll2, _) = get_candidate_pda(2, "Alice");
        assert_ne!(alice_poll1, alice_poll2, "same name in different polls = different PDAs");

        // Register Alice in both polls
        send_ix(&mut svm, create_initialize_candidate_ix(
            &user.pubkey(), &poll1_pda, &alice_poll1, "Alice", 1,
        ), &user).unwrap();
        send_ix(&mut svm, create_initialize_candidate_ix(
            &user.pubkey(), &poll2_pda, &alice_poll2, "Alice", 2,
        ), &user).unwrap();

        // Vote for Alice in poll 1 only
        send_ix(&mut svm, create_vote_ix(
            &user.pubkey(), &poll1_pda, &alice_poll1, "Alice", 1,
        ), &user).unwrap();

        // Verify: Alice in poll 1 has 1 vote, Alice in poll 2 has 0 votes
        let a1 = svm.get_account(&alice_poll1).unwrap();
        let (_, votes1) = parse_candidate_data(&a1.data);
        assert_eq!(votes1, 1, "Alice in poll 1 should have 1 vote");

        let a2 = svm.get_account(&alice_poll2).unwrap();
        let (_, votes2) = parse_candidate_data(&a2.data);
        assert_eq!(votes2, 0, "Alice in poll 2 should have 0 votes");
    }
}

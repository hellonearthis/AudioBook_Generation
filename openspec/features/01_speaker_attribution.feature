@domain @attribution
Feature: Speaker Attribution and Unmarked Dialogue Extraction
  As an audiobook production engine
  I want to resolve speakers and detect unmarked dialogue from manuscript prose
  So that every line in the screenplay is cleanly assigned to a voice actor without misattributing dialogue to the narrator

  Background:
    Given a loaded manuscript chapter and an active cast list containing character profiles

  Rule: Spoken dialogue must be resolved to specific characters or escalated to manual review

    @SPEAKER-01
    Scenario: Deterministic speech tag identification from neighboring prose
      Given a prose passage containing spoken dialogue flanked by an explicit speech verb "said Maren"
      When the attribution pipeline evaluates the dialogue span
      Then the speaker is resolved to "Maren" with high deterministic confidence
      And the segment is marked as auto-accepted without requiring user escalation

    @SPEAKER-02
    Scenario: Ambiguous speaker candidate score falling below acceptance cutoff
      Given a dialogue span with low multi-model consensus and confidence below 0.35
      When the attribution pipeline scores the candidate distribution
      Then the speaker attribution transitions to "unknown"
      And the screenplay segment is flagged for manual review in the triage queue

    @SPEAKER-03
    Scenario: Multi-paragraph monologue continuation across paragraph boundaries
      Given a preceding paragraph ending without a closing quotation mark
      And a following paragraph opening with a quotation mark spoken by the same character
      When the conversational state evaluates multi-paragraph continuity
      Then the monologue continuation rule attributes the subsequent paragraph to the existing speaker
      And the conversational history updates without splitting character identity

    @SPEAKER-04
    Scenario: Boundary extraction of unmarked dialogue passages
      Given a narrative paragraph containing unspoken dialogue lacking typographical quotes
      When the unmarked dialogue detector processes lexical and grammatical cues
      Then the spoken sentence is partitioned into a dedicated `unmarked_dialogue` span
      And the remaining text is preserved as surrounding narrator prose


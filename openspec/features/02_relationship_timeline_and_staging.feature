@domain @staging
Feature: Interpersonal Dynamics and Directorial Staging
  As an audiobook directorial director
  I want to resolve active relationship states and harvest acoustic narrative cues
  So that voice synthesizers receive precise vocal directions and emotion conditioning

  Background:
    Given a project timeline containing character relationship deltas and screenplay segments

  Rule: Interpersonal standing and narrative delivery must condition vocal synthesis parameters

    @STAGING-01
    Scenario: Bidirectional relationship state lookup at a specific segment index
      Given a defined relationship between characters "Josh" and "Maren" with an estrangement delta at segment 200
      When the timeline engine resolves the active state for segment index 214
      Then the interpersonal status is retrieved as estranged with tense tone and equal power dynamic
      And the pair identifier is normalized bidirectionally as "josh_maren"

    @STAGING-02
    Scenario: AuK-08 canonical emotion palette normalization
      Given an extracted raw sentiment label such as "furious" or "rage"
      When the emotion mapping engine normalizes the label against the `auk_postprod_pipeline` palette
      Then the canonical emotion resolves to "angry" within the 9-emotion set
      And unsupported raw labels safely default to neutral without pipeline crashing

    @STAGING-03
    Scenario: Whisper acoustic cue extraction from narrative context
      Given narrative prose containing the description "her voice dropping to an urgent whisper"
      When the staging harvester extracts acoustic cues for the associated dialogue card
      Then the directorial prompt is enriched with a whisper vocal flag
      And the audio synthesis workflow routes the take to whisper post-production conditioning

    @STAGING-04
    Scenario: Relationship delta timeline progression across scene shifts
      Given an existing relationship record between two characters established in chapter one
      When a new delta transition occurs during an escalating conflict in chapter three
      Then the updated relationship state takes effect monotonically from the target segment forward
      And earlier segment playback retains historical relationship context


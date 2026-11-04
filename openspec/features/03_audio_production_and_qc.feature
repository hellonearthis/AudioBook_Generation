@domain @production
Feature: Sequential Audio Generation Queue and Whistle Quality Control
  As an audiobook production engineer
  I want single-threaded GPU arbitration and automated speech validation
  So that hardware resources avoid out-of-memory crashes and flawed audio takes are caught immediately

  Background:
    Given an operational ComfyUI backend and an active project screenplay

  Rule: Synthesis tasks must execute sequentially and pass automated acoustic quality inspection

    @AUDIO-01
    Scenario: Single-threaded GPU queue task execution
      Given multiple screenplay segments scheduled for batch voice synthesis
      When the sequential audio queue dispatches tasks to the ComfyUI server
      Then tasks execute strictly one at a time to prevent GPU VRAM exhaustion
      And subsequent tasks wait until preceding takes complete history polling

    @AUDIO-02
    Scenario: Whistle speech-to-text accuracy verification threshold
      Given a freshly synthesized speech audio take and its expected script dialogue
      When the `whistle_qc_validation` engine inspects the audio waveform
      Then the acoustic transcription word accuracy is measured against the screenplay text
      And takes achieving at least 90 percent match are marked verified while failures trigger re-takes

    @AUDIO-03
    Scenario: Fountain screenplay document serialization and roundtrip
      Given an active project containing attributed screenplay segments and directorial notes
      When the project is exported into a standardized `fountain_document` format
      Then character dialogue, narrator prose, and scene headings format according to Fountain syntax
      And re-importing the plain-text file reconstructs all screenplay segment cards without loss

    @AUDIO-04
    Scenario: Multi-chapter manuscript segmentation with shared cast persistence
      Given a continuous novel manuscript containing multiple chapter headings and an established character cast
      When the `multi_chapter_manuscript` service splits the document into discrete chapters
      Then screenplay segments are partitioned by chapter units with calculated word counts and runtimes
      And the shared character cast and voice matrix remain globally persistent across all chapters

    @AUDIO-05
    Scenario: Direct reference audio voice import bypassing synthetic generation
      Given an external audio recording of an actor audition or curated character reference take
      When the `direct_voice_import` service ingests the audio file into the project anchor directory
      Then the audio file is normalized to a master anchor WAV and assigned to the character record
      And 100 percent synthetic VoiceDesign prompt generation is skipped with the character marked ready for tuning

    @AUDIO-06
    Scenario: Phonetic calibration tuning and clone timbre verification
      Given an imported character voice anchor and a phonetically balanced calibration phrase
      When the `phonetic_calibration_tuning` pipeline synthesizes and audits the tuning take
      Then the synthesized take achieves at least 0.75 cosine similarity against the imported reference
      And a baseline character capability profile is recorded before chapter synthesis begins


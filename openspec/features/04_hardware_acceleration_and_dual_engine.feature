@domain @hardware @engine
Feature: Dual-Engine Hardware Arbitration and NPU Offloading
  As an audiobook production system
  I want to partition cognitive workloads between an NPU fast engine and a GPU deep reasoning engine
  So that speaker routing runs with zero VRAM overhead while high-parameter narrative staging executes efficiently without crashing

  Background:
    Given an environment configured with a `laya_npu_engine` at "http://127.0.0.1:8765" and a `llamacpp_gpu_engine` at "http://127.0.0.1:8080"

  Rule: Workloads must route to the optimal hardware engine and fail over gracefully if a service is unreachable

    @ENGINE-01
    Scenario: Fast dialogue routing offloaded to the Laya NPU engine
      Given an incoming unmarked dialogue text candidate
      When the attribution service evaluates the binary speech boundary via the `laya_npu_engine`
      Then the decision latency executes in sub-50 milliseconds on the NPU
      And zero GPU VRAM is consumed for the attribution step

    @ENGINE-02
    Scenario: Deep narrative staging executed on the llama.cpp GPU engine
      Given an attributed chapter segment requiring cast extraction and relationship delta analysis
      When the pipeline dispatches the complex prompt to the `llamacpp_gpu_engine`
      Then the engine returns structured JSON containing directorial prosody and emotional staging
      And the relationship timeline state updates monotonically

    @ENGINE-03
    Scenario: Graceful fallback to GPU when Laya NPU service is unreachable
      Given the `laya_npu_engine` is offline or fails health ping on port 8765
      When the attribution service attempts to classify a candidate dialogue span
      Then the pipeline automatically fails over to the `llamacpp_gpu_engine`
      And execution completes without throwing unhandled exceptions or halting the batch


sequenceDiagram
    actor User
    participant UI as AI Panel UI
    participant Model as Model Selection
    participant Capabilities as Capability System
    participant Generation as useAIGeneration
    participant API as FAL API
    participant MediaStore as Media Store

    User->>UI: Select T2V models
    UI->>Model: Update selectedModels
    Model->>Capabilities: getCombinedCapabilities(selectedModels)
    Capabilities-->>UI: Return intersected capabilities
    UI->>UI: Render clamped T2V settings<br/>(aspect_ratio, duration, resolution)
    
    User->>UI: Enter prompt + adjust settings
    User->>UI: Click Generate
    UI->>Generation: Call generateVideo with t2v*Props
    
    Generation->>Generation: Validate duration vs. capabilities<br/>(getSafeDuration clamping)
    Generation->>Generation: Build unifiedParams<br/>(sanitize to capability ranges)
    Generation->>API: Send request with unifiedParams
    API-->>Generation: Return video_url + metadata
    
    Generation->>MediaStore: Download + create media item
    Generation->>MediaStore: addMediaItem with unified metadata
    MediaStore-->>Generation: Persist to storage
    Generation->>UI: Update progress to 100% + onComplete
    UI-->>User: Display generated video

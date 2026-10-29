---
version: "2026.10.29.3"
date: "2026-10-29"
channel: "stable"
---

# QCut v2026.10.29.3

### Fixed

- A native export with the master limiter on no longer turns the whole mix down when encoding pushes the true peak over the ceiling. Only the moments around the overshoot come down (each 100 ms block within 0.75 dB of the ceiling, to 1.25 dB under it), and the rest of the mix keeps its level. The encoder's peaks move by tenths of a dB with any change to the file, and the whole export used to follow the worst of them: a trailer exported 0.42 dB quieter everywhere after one silent clip was replaced. A mix that needs the correction now exports louder than before, closer to the mix as heard in the editor (that trailer: about 0.5 LU). `audioValidation.limiting` reports `correctedSeconds` and `maxCorrectionDb` in place of `attenuationDb`; an export whose first encode passes is unchanged.
- Duplicating a project on macOS clones its media (APFS copy-on-write) instead of copying every file in full: the duplicate takes almost no disk space until a file changes in one of the two projects, and either can change without the other (512 MB of media: no space and 5 ms, where it took 512 MB and 0.4 s). Node cannot clone files on macOS (its `COPYFILE_FICLONE` copies in full), so the copy goes through the system's `cp -c`, which copies in full itself across volumes or on a file system without clones.
- A stored project whose complete JSON is followed by stray characters loads again; such files were left by two saves that overlapped before v2026.09.28.1, when saves still rewrote the file in place. The JSON before the stray characters is read after the file is copied aside as it was (`….json.damaged-<hash>`), and the file itself is left for the next save to replace. A file damaged any other way is reported with its path. Saves already write a temporary file and rename it, one at a time per file.

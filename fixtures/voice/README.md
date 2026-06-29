# Voice Gardener demo fixture

The acceptance demo generates audio locally with macOS `say`, then round-trips through Groq/OpenAI STT into Gardener inbox.

Fixed phrase (must match smoke script):

```text
Route the artifacts end to end proof through gardener inbox.
```

Regenerate manually:

```bash
say -o /tmp/stack-voice-demo.aiff "Route the artifacts end to end proof through gardener inbox."
ffmpeg -y -i /tmp/stack-voice-demo.aiff -ar 16000 -ac 1 demo.wav
```

Run the demo:

```bash
cd ~/Documents/GitHub/stack
bun run smoke:voice:gardener-demo
```

Proof lands under `.stack/evidence/voice-demo/<stamp>/summary.json`.

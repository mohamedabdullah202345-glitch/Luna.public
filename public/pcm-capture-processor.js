class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetRate = 16000;
    this._targetChunkSamples = 640; // 40ms at 16kHz for lower voice latency
    this._minInputSamples = Math.max(
      640,
      Math.round((sampleRate / this._targetRate) * this._targetChunkSamples)
    );
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this._buffer.push(channel[i]);
    }

    while (this._buffer.length >= this._minInputSamples) {
      const slice = this._buffer.splice(0, this._minInputSamples);
      let sumSq = 0;
      for (let i = 0; i < slice.length; i++) {
        sumSq += slice[i] * slice[i];
      }
      const rms = Math.sqrt(sumSq / slice.length);
      const level = Math.min(1, rms * 9);

      const ratio = sampleRate / this._targetRate;
      const outLength = Math.max(1, Math.round(slice.length / ratio));
      const pcm = new Int16Array(outLength);

      let outIdx = 0;
      let inOffset = 0;
      while (outIdx < outLength) {
        const nextOffset = Math.round((outIdx + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = inOffset; i < nextOffset && i < slice.length; i++) {
          accum += slice[i];
          count++;
        }
        const sample = count > 0 ? accum / count : 0;
        const clamped = Math.max(-1, Math.min(1, sample));
        pcm[outIdx] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        outIdx++;
        inOffset = nextOffset;
      }

      this.port.postMessage({ pcm: pcm.buffer, level }, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);

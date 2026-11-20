"""Private BCC helper. Never auto-select an input. No PCM is written or transmitted."""
import argparse
import json
import queue
import sys


def main():
    from vosk import Model, KaldiRecognizer, SetLogLevel
    import sounddevice as sd
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--device')
    ap.add_argument('--model')
    args = ap.parse_args()
    if args.list:
        print(sd.query_devices())
        return
    matches = [(i, x) for i, x in enumerate(sd.query_devices()) if x['max_input_channels'] and x['name'] == args.device]
    if len(matches) != 1 or not args.model:
        sys.exit('Verified program input unavailable or ambiguous; capture remains off.')
    idx, info = matches[0]
    rate = int(info['default_samplerate'])
    SetLogLevel(-1)
    model = Model(args.model)
    rec = KaldiRecognizer(model, rate)
    # A fresh decoder is started for each permitted interval; never flush after mute.
    with sd.RawInputStream(device=idx, samplerate=rate, dtype='int16', channels=1) as stream:
        blocks = 0
        while True:
            data, overflow = stream.read(max(1, rate // 10))
            if overflow:
                rec.Reset()
                blocks = 0
                continue
            blocks += 1
            ready = rec.AcceptWaveform(bytes(data))
            if not ready and blocks < 80:
                continue
            result = json.loads(rec.Result() if ready else rec.FinalResult())
            if not ready:
                rec.Reset()
            blocks = 0
            text = result.get('text', '').strip()
            if text:
                print(json.dumps({'text': text[:1400]}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        pass

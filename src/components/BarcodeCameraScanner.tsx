import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
  title?: string;
};

/** Camera scanner for 1D retail barcodes (EAN/UPC/Code 128) and common 2D codes. */
export function BarcodeCameraScanner({ open, onClose, onDetected, title = 'Barcode ဖတ်ရန်' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [status, setStatus] = useState('Camera ဖွင့်နေပါတယ်…');
  const [error, setError] = useState('');

  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let controls: { stop: () => void } | null = null;
    const reader = new BrowserMultiFormatReader();
    setStatus('Camera ဖွင့်နေပါတယ်…');
    setError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('ဒီ Browser မှာ Camera အသုံးပြုခွင့် မရနိုင်ပါ။ HTTPS ဖြင့်ဖွင့်ထားကြောင်း စစ်ပါ။');
      return () => { active = false; };
    }

    void reader.decodeFromVideoDevice(undefined, videoRef.current!, (result, _decodeError, scanControls) => {
      if (!active || !result) return;
      active = false;
      scanControls.stop();
      onDetectedRef.current(result.getText());
    }).then((startedControls) => {
      controls = startedControls;
      if (!active) startedControls.stop();
      else setStatus('Barcode ကို Camera အလယ်မှာထားပြီး ဖတ်ပါ။');
    }).catch((scanError: unknown) => {
      if (!active) return;
      const message = scanError instanceof Error ? scanError.message : String(scanError);
      if (/NotAllowedError|Permission denied|denied/i.test(message)) {
        setError('Camera Permission ပိတ်ထားပါတယ်။ Browser Settings မှ Camera ကို Allow လုပ်ပြီး ပြန်စမ်းပါ။');
      } else if (/NotFoundError|DevicesNotFoundError/i.test(message)) {
        setError('ဒီ Device မှာ Camera မတွေ့ပါ။');
      } else {
        setError(`Camera ဖွင့်မရပါ။ ${message}`);
      }
    });

    return () => {
      active = false;
      controls?.stop();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop barcode-scanner-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card barcode-scanner-card" role="dialog" aria-modal="true" aria-labelledby="barcode-scanner-title">
        <div className="modal-header">
          <div><h2 id="barcode-scanner-title"><Camera size={18} /> {title}</h2><p>ပစ္စည်းပေါ်က Barcode ကို Camera အလယ်မှာထားပါ။</p></div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Scanner ပိတ်ရန်"><X size={19} /></button>
        </div>
        <div className="barcode-camera-frame">
          <video ref={videoRef} className="barcode-camera-video" autoPlay muted playsInline />
          <span className="barcode-camera-guide" />
        </div>
        {error ? <p className="barcode-camera-error" role="alert">{error}</p> : <p className="barcode-camera-status">{status}</p>}
        <div className="modal-actions"><button className="button button-outline" type="button" onClick={onClose}>ပိတ်မယ်</button></div>
      </section>
    </div>
  );
}

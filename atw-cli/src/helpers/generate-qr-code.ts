import qrcode from "qrcode-terminal";

export const generateQrCode = async (input: string, small = true) =>
  new Promise<string>((resolve, reject) => {
    qrcode.generate(input, { small }, (qrcode) => {
      if (qrcode) {
        resolve(qrcode);
      } else {
        reject(new Error("Failed to generate QR code"));
      }
    });
  });

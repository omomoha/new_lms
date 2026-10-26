import { connectStorageEmulator, getStorage } from "firebase/storage";
import app from "./config";

const storage = getStorage(app);

const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;
if (typeof window !== "undefined" && emulatorHost) {
  connectStorageEmulator(storage, emulatorHost, 9199);
}

export default storage;

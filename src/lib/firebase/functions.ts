import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import app from "./config";

const functions = getFunctions(app);

const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;
if (typeof window !== "undefined" && emulatorHost) {
  connectFunctionsEmulator(functions, emulatorHost, 5001);
}

export default functions;

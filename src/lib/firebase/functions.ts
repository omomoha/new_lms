import { getFunctions } from "firebase/functions";
import app from "./config";

const functions = getFunctions(app);
export default functions;

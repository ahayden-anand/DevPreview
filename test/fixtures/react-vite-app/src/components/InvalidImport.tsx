// @ts-ignore
import { nonexistentHelper } from './nonexistentModule';

export default function InvalidImport() {
  return <div>{nonexistentHelper()}</div>;
}

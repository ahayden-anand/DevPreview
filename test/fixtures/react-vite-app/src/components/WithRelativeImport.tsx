import { SubText } from './SubText';

export default function WithRelativeImport() {
  return (
    <div>
      <h3>Main Component</h3>
      <SubText text="Rendered from relative import" />
    </div>
  );
}

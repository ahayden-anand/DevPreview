interface StyledButtonProps {
  label?: string;
  backgroundColor?: string;
  textColor?: string;
}

export default function StyledButton({
  label = "Styled Button",
  backgroundColor = "pink",
  textColor = "white",
}: StyledButtonProps) {
  return (
    <button
      className="styled-btn"
      style={{ backgroundColor, color: textColor }}
    >
      {label}
    </button>
  );
}
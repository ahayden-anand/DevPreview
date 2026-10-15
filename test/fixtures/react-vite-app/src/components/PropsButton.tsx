export interface PropsButtonProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  count?: number;
  disabled?: boolean;
}

export default function PropsButton({ label, variant = 'primary', count = 0, disabled }: PropsButtonProps) {
  return (
    <button
      data-testid="props-btn"
      data-variant={variant}
      disabled={disabled}
      style={{
        padding: '8px 16px',
        backgroundColor: variant === 'primary' ? '#0070f3' : variant === 'danger' ? '#e00' : '#888',
        color: '#fff',
        border: 'none',
        borderRadius: '4px'
      }}
    >
      {label} {count > 0 ? `(${count})` : ''}
    </button>
  );
}

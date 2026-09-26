interface WarningButtonProps {
  onClick?: () => void;
}

export default function WarningButton({ onClick }: WarningButtonProps) {
  return (
    <button className="button" onClick={onClick}>
      <img src="alert.png"></img>
    </button>
  );
}
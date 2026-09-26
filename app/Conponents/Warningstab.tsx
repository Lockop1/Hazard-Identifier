interface WarningTabProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WarningTab({ isOpen, onClose }: WarningTabProps) {
  return (
    <div
      className={`warningtab flex flex-col items-center justify-center  text-center ${
        isOpen ? "open" : ""
      }`}
    >
      <h1>Incidents</h1>
      <ul>
        <li>
          <h2>Police</h2>
          <div className="circle">
            <img
              src="police.png"
              alt="Police"
              className=""
            />
          </div>
          <p>X nearby reports</p>
        </li>
        <li>
          <h2>Accidents</h2>
          <div className="circle">
            <img src="car-collision.png" alt="Accidents" className="size-9" />
          </div>
          <p>X nearby reports</p>
        </li>
        <li>
          <h2>Construction</h2>
          <div className="circle">
            <img
              src="Roadblock.png"
              alt="Construction"
              className=""
            />
          </div>
        
          <p>X nearby reports</p>
        </li>
      </ul>
      <ul>
        <li>
          <h2>Traffic Signal Issue</h2>
          <div className="circle"></div>
          <p>X nearby reports</p>
        </li>
        <li>
          <h2>Others</h2>
          <div className="circle"></div>
          <p>X nearby reports</p>
        </li>
      </ul>
    </div>
  );
}

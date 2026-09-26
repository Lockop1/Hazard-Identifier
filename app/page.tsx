"use client";


import WarningTab from "./Conponents/Warningstab";
import PlusButton from "./Conponents/Buttons/Button";
import MinusButton from "./Conponents/Buttons/Minus button";


import { useState } from "react";


export default function Home() {
  const [isOpen, setIsOpen] = useState(false);
 
  return (
    <>
      {/*"Top Bar"*/}
      {/*"Side buttons"*/}
      <div className="fixed right-0">
        <div className="sidebuttonsgroup">
          <PlusButton></PlusButton>
          <MinusButton></MinusButton>
          <button className="button" onClick={() => setIsOpen(true)}>

          </button>
          
          <div>1</div>
        </div>
      </div>
      {/*"Accident Reports popup"*/}
    <WarningTab isOpen={isOpen} onClose={() => setIsOpen(false)}/>
      {/*"Search Bar"*/}
      
    </>
  );
}

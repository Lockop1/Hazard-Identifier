import { Warning } from "postcss"
import PlusButton from "./Buttons/Button"
import MinusButton from "./Buttons/Minus button"
import WarningButton from "./Buttons/Warning Button"
export default function Sidebar() {
  return( 
  <div className="sidebuttonsgroup">
    <PlusButton></PlusButton>
    <MinusButton></MinusButton>
    <WarningButton></WarningButton>
    <div>1</div>
  </div>
  )
}
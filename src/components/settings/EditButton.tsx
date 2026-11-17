import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";

interface EditButtonProps {
  onClick: () => void;
}

const EditButton = ({ onClick }: EditButtonProps) => {
  return (
    <Button onClick={onClick} variant="ghost" size="icon" aria-label="打开主题设置" title="主题设置">
      <SlidersHorizontal className="h-5 w-5" />
    </Button>
  );
};

export default EditButton;

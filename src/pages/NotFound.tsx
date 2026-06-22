import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { useLocale } from "@/config/hooks";

export default function NotFound() {
  const navigate = useNavigate();
  const { t } = useLocale();

  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <Card className="w-(--main-width) max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            {t("notFoundPage.title")}
          </CardTitle>
          <CardDescription>{t("notFoundPage.description")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => navigate("/")} className="w-full">
            {t("notFoundPage.goToHome")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

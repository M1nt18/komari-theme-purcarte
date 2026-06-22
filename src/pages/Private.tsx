import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocale } from "@/config/hooks";

export default function Private() {
  const { t } = useLocale();
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <Card className="w-(--main-width) max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            {t("privatePage.title")}
          </CardTitle>
          <CardDescription>{t("privatePage.description")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <a
            href="/admin"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full">
            <Button className="w-full">{t("privatePage.goToLogin")}</Button>
          </a>
        </CardFooter>
      </Card>
    </div>
  );
}

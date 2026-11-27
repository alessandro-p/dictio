import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PlaygroundBanner() {
  return (
    <Alert className="rounded-none border-x-0 border-t-0">
      <AlertTitle>Experimental playground</AlertTitle>
      <AlertDescription>
        dictio is an experiment. Your data lives only in this browser and may be
        lost.
      </AlertDescription>
    </Alert>
  );
}

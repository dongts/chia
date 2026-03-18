import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Wallet } from "lucide-react";
import { joinGroup } from "@/api/groups";

export default function JoinGroup() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteCode) {
      setStatus("error");
      setErrorMsg("Invalid invite link");
      return;
    }
    joinGroup(inviteCode)
      .then((group) => {
        setGroupId(group.id);
        setStatus("success");
        // Auto-redirect after short delay
        setTimeout(() => navigate(`/groups/${group.id}`), 1200);
      })
      .catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "Failed to join group";
        setErrorMsg(msg);
        setStatus("error");
      });
  }, [inviteCode, navigate]);

  return (
    <div className="text-center">
      <div className="w-14 h-14 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Wallet size={26} className="text-white" />
      </div>

      {status === "loading" && (
        <>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Joining group...</h1>
          <p className="text-sm text-gray-500">Please wait a moment</p>
          <div className="mt-6 flex justify-center">
            <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </>
      )}

      {status === "success" && (
        <>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Joined!</h1>
          <p className="text-sm text-gray-500">Redirecting you to the group...</p>
          {groupId && (
            <button
              onClick={() => navigate(`/groups/${groupId}`)}
              className="mt-4 text-sm text-green-600 underline"
            >
              Go now
            </button>
          )}
        </>
      )}

      {status === "error" && (
        <>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Couldn't join</h1>
          <p className="text-sm text-red-500 mb-4">{errorMsg}</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm text-green-600 hover:underline font-medium"
          >
            Go to Dashboard
          </button>
        </>
      )}
    </div>
  );
}

using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
public static class AureliaBuild
{
    public static void Web()
    {
        var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        new GameObject("AureliaClient").AddComponent<AureliaClient>();
        Directory.CreateDirectory("Assets/Scenes");EditorSceneManager.SaveScene(scene,"Assets/Scenes/Battlefield.unity");
        PlayerSettings.companyName="Automationation";PlayerSettings.productName="AURELIA: Empires of the Sun";
        PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.nameFilesAsHashes=false;PlayerSettings.WebGL.decompressionFallback=false;
        PlayerSettings.WebGL.initialMemorySize=128;PlayerSettings.WebGL.maximumMemorySize=512;
        UnityEditor.WebGL.UserBuildSettings.codeOptimization=UnityEditor.WebGL.WasmCodeOptimization.BuildTimes;
        PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.WebGL,ScriptingImplementation.IL2CPP);
        PlayerSettings.stripEngineCode=true;PlayerSettings.runInBackground=true;
        string target=Path.GetFullPath(Path.Combine(Application.dataPath,"../../Web/unity"));
        var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Scenes/Battlefield.unity"},locationPathName=target,target=BuildTarget.WebGL,options=BuildOptions.None});
        if(report.summary.result!=BuildResult.Succeeded)throw new Exception("Aurelia Web build failed: "+report.summary.result);
        Debug.Log("AURELIA_BUILD_SUCCEEDED "+report.summary.totalSize);
    }
}
